import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { CognitoStackProps, CognitoResources, createDefaultUserPoolConfig, createDefaultLambdaConfig } from './types';
import { ParameterStoreHelper } from './parameter-store-helper';

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolArn: string;
  public readonly postConfirmationLambda: lambda.Function;
  public readonly retryProcessorLambda: lambda.Function;
  public readonly primaryRetryQueue: sqs.Queue;
  public readonly manualInterventionQueue: sqs.Queue;
  public readonly adminAlertTopic: sns.Topic;
  
  private readonly environmentName: string;
  private readonly parameterStoreHelper: ParameterStoreHelper;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    this.environmentName = props.environment;

    // Initialize Parameter Store helper
    this.parameterStoreHelper = new ParameterStoreHelper(this, {
      environment: props.environment,
      stackName: this.stackName,
    });

    // Create infrastructure resources first
    this.adminAlertTopic = this.createAdminAlertTopic();
    this.primaryRetryQueue = this.createPrimaryRetryQueue();
    this.manualInterventionQueue = this.createManualInterventionQueue();
    
    // Create Lambda functions
    this.retryProcessorLambda = this.createRetryProcessorLambda(props);
    
    // Create Cognito resources
    const cognitoResources = this.createCognitoResources(props);
    
    // Assign public properties
    this.userPool = cognitoResources.userPool;
    this.userPoolArn = cognitoResources.userPool.userPoolArn;
    this.postConfirmationLambda = cognitoResources.postConfirmationLambda;

    // Set up monitoring and alarms
    this.createMonitoringAndAlarms();

    // Create outputs and parameter store entries
    this.createOutputs();

    // Add tags to all resources
    this.addResourceTags();
  }

  private createCognitoResources(props: CognitoStackProps): CognitoResources {
    // Create post-confirmation Lambda function first
    const postConfirmationLambda = this.createPostConfirmationLambda(props);

    // Create User Pool with Lambda trigger
    const userPool = this.createUserPool(postConfirmationLambda);

    return {
      userPool,
      postConfirmationLambda,
    };
  }

  private createPostConfirmationLambda(props: CognitoStackProps): lambda.Function {
    const lambdaConfig = createDefaultLambdaConfig(
      props.environment,
      props.usersTableName,
      props.usersTableArn
    );

    // Create Lambda function
    const postConfirmationLambda = new lambda.Function(this, 'PostConfirmationLambda', {
      functionName: lambdaConfig.functionName,
      runtime: lambdaConfig.runtime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/post-confirmation'),
      timeout: lambdaConfig.timeout,
      environment: {
        USERS_TABLE_NAME: props.usersTableName,
        NODE_ENV: props.environment,
        PRIMARY_RETRY_QUEUE_URL: this.primaryRetryQueue.queueUrl,
      },
      description: `Post-confirmation Lambda for Cognito User Pool - ${props.environment}`,
    });

    // Grant DynamoDB permissions to Lambda
    postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [props.usersTableArn],
      })
    );

    // Add CloudWatch Logs permissions
    postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/${lambdaConfig.functionName}:*`],
      })
    );

    // Add CloudWatch Metrics permissions
    postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'], // CloudWatch metrics don't support resource-level permissions
      })
    );

    // Add SQS permissions for retry queue
    postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sqs:SendMessage',
        ],
        resources: [this.primaryRetryQueue.queueArn],
      })
    );

    return postConfirmationLambda;
  }

  private createAdminAlertTopic(): sns.Topic {
    return new sns.Topic(this, 'AdminAlertTopic', {
      topicName: `acorn-pups-${this.environmentName}-admin-alerts`,
      displayName: `Acorn Pups Admin Alerts - ${this.environmentName}`,
    });
  }

  private createPrimaryRetryQueue(): sqs.Queue {
    // Dead letter queue for primary retry queue
    const primaryRetryDlq = new sqs.Queue(this, 'PrimaryRetryDLQ', {
      queueName: `acorn-pups-${this.environmentName}-primary-retry-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    return new sqs.Queue(this, 'PrimaryRetryQueue', {
      queueName: `acorn-pups-${this.environmentName}-primary-retry`,
      visibilityTimeout: cdk.Duration.minutes(5), // Match Lambda timeout + buffer
      retentionPeriod: cdk.Duration.days(7),
      receiveMessageWaitTime: cdk.Duration.seconds(20), // Long polling
      deadLetterQueue: {
        queue: primaryRetryDlq,
        maxReceiveCount: 3,
      },
    });
  }

  private createManualInterventionQueue(): sqs.Queue {
    return new sqs.Queue(this, 'ManualInterventionQueue', {
      queueName: `acorn-pups-${this.environmentName}-manual-intervention`,
      visibilityTimeout: cdk.Duration.hours(1), // Manual processing takes time
      retentionPeriod: cdk.Duration.days(14), // Keep for longer review
      receiveMessageWaitTime: cdk.Duration.seconds(20),
    });
  }

  private createRetryProcessorLambda(props: CognitoStackProps): lambda.Function {
    const retryLambda = new lambda.Function(this, 'RetryProcessorLambda', {
      functionName: `acorn-pups-${props.environment}-retry-processor`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/retry-processor'),
      timeout: cdk.Duration.minutes(5),
      environment: {
        USERS_TABLE_NAME: props.usersTableName,
        NODE_ENV: props.environment,
        PRIMARY_RETRY_QUEUE_URL: this.primaryRetryQueue.queueUrl,
        MANUAL_INTERVENTION_QUEUE_URL: this.manualInterventionQueue.queueUrl,
        ADMIN_ALERT_TOPIC_ARN: this.adminAlertTopic.topicArn,
        MAX_RETRY_ATTEMPTS: '3',
      },
      description: `Retry processor Lambda for failed user creation operations - ${props.environment}`,
    });

    // Grant DynamoDB permissions
    retryLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [props.usersTableArn],
      })
    );

    // Grant SQS permissions
    retryLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sqs:SendMessage',
        ],
        resources: [
          this.primaryRetryQueue.queueArn,
          this.manualInterventionQueue.queueArn,
        ],
      })
    );

    // Grant SNS permissions
    retryLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sns:Publish',
        ],
        resources: [this.adminAlertTopic.topicArn],
      })
    );

    // Grant CloudWatch Metrics permissions
    retryLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    );

    // Add SQS event source
    retryLambda.addEventSource(new lambdaEventSources.SqsEventSource(this.primaryRetryQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(30),
    }));

    return retryLambda;
  }

  private createMonitoringAndAlarms(): void {
    // Create CloudWatch alarms for monitoring
    
    // Alarm for manual intervention queue depth
    new cloudwatch.Alarm(this, 'ManualInterventionQueueDepthAlarm', {
      alarmName: `acorn-pups-${this.environmentName}-manual-intervention-queue-depth`,
      alarmDescription: 'Manual intervention queue has messages requiring attention',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfVisibleMessages',
        dimensionsMap: {
          QueueName: this.manualInterventionQueue.queueName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).addAlarmAction({
      bind: () => ({
        alarmActionArn: this.adminAlertTopic.topicArn,
      }),
    });

    // Alarm for high retry queue depth
    new cloudwatch.Alarm(this, 'RetryQueueDepthAlarm', {
      alarmName: `acorn-pups-${this.environmentName}-retry-queue-depth`,
      alarmDescription: 'Primary retry queue has high depth indicating processing issues',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfVisibleMessages',
        dimensionsMap: {
          QueueName: this.primaryRetryQueue.queueName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 50,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).addAlarmAction({
      bind: () => ({
        alarmActionArn: this.adminAlertTopic.topicArn,
      }),
    });

    // Alarm for Lambda errors
    new cloudwatch.Alarm(this, 'RetryLambdaErrorAlarm', {
      alarmName: `acorn-pups-${this.environmentName}-retry-lambda-errors`,
      alarmDescription: 'Retry processor Lambda is experiencing errors',
      metric: this.retryProcessorLambda.metricErrors(),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).addAlarmAction({
      bind: () => ({
        alarmActionArn: this.adminAlertTopic.topicArn,
      }),
    });

    // Custom metric alarm for user creation failures
    new cloudwatch.Alarm(this, 'UserCreationFailureAlarm', {
      alarmName: `acorn-pups-${this.environmentName}-user-creation-failures`,
      alarmDescription: 'High rate of user creation failures detected',
      metric: new cloudwatch.Metric({
        namespace: 'AcornPups/UserRegistration',
        metricName: 'UserCreationImmediateFailure',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction({
      bind: () => ({
        alarmActionArn: this.adminAlertTopic.topicArn,
      }),
    });
  }

  private createUserPool(postConfirmationLambda: lambda.Function): cognito.UserPool {
    const userPoolConfig = createDefaultUserPoolConfig(this.environmentName);

    // Create User Pool
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: userPoolConfig.userPoolName,
      selfSignUpEnabled: userPoolConfig.selfSignUpEnabled,
      signInAliases: {
        email: userPoolConfig.signInAliases.email,
        username: userPoolConfig.signInAliases.username,
      },
      autoVerify: {
        email: userPoolConfig.autoVerify.email,
        phone: userPoolConfig.autoVerify.phone,
      },
      standardAttributes: {
        email: {
          required: userPoolConfig.standardAttributes.email.required,
          mutable: userPoolConfig.standardAttributes.email.mutable,
        },
        fullname: {
          required: userPoolConfig.standardAttributes.fullname.required,
          mutable: userPoolConfig.standardAttributes.fullname.mutable,
        },
      },
      mfa: userPoolConfig.mfaConfiguration,
      accountRecovery: userPoolConfig.accountRecovery,
      passwordPolicy: {
        minLength: userPoolConfig.passwordPolicy.minLength,
        requireUppercase: userPoolConfig.passwordPolicy.requireUppercase,
        requireLowercase: userPoolConfig.passwordPolicy.requireLowercase,
        requireDigits: userPoolConfig.passwordPolicy.requireDigits,
        requireSymbols: userPoolConfig.passwordPolicy.requireSymbols,
        tempPasswordValidity: userPoolConfig.passwordPolicy.tempPasswordValidity,
      },
      lambdaTriggers: {
        postConfirmation: postConfirmationLambda,
      },
      removalPolicy: this.environmentName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Grant Cognito permission to invoke the Lambda function
    postConfirmationLambda.addPermission('CognitoInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: userPool.userPoolArn,
    });

    return userPool;
  }

  private createOutputs(): void {
    // Create outputs with Parameter Store integration
    this.parameterStoreHelper.createOutputWithParameter(
      'UserPoolId',
      this.userPool.userPoolId,
      'ID of the Cognito User Pool',
      `acorn-pups-user-pool-id-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/user-pool/id`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'UserPoolArn',
      this.userPool.userPoolArn,
      'ARN of the Cognito User Pool',
      `acorn-pups-user-pool-arn-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/user-pool/arn`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'UserPoolName',
      `acorn-pups-${this.environmentName}-user-pool`,
      'Name of the Cognito User Pool',
      `acorn-pups-user-pool-name-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/user-pool/name`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'PostConfirmationLambdaArn',
      this.postConfirmationLambda.functionArn,
      'ARN of the post-confirmation Lambda function',
      `acorn-pups-post-confirmation-lambda-arn-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/post-confirmation-lambda/arn`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'PostConfirmationLambdaName',
      this.postConfirmationLambda.functionName,
      'Name of the post-confirmation Lambda function',
      `acorn-pups-post-confirmation-lambda-name-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/post-confirmation-lambda/name`
    );

    // Retry processing infrastructure outputs
    this.parameterStoreHelper.createOutputWithParameter(
      'RetryProcessorLambdaArn',
      this.retryProcessorLambda.functionArn,
      'ARN of the retry processor Lambda function',
      `acorn-pups-retry-processor-lambda-arn-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/retry-processor-lambda/arn`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'PrimaryRetryQueueUrl',
      this.primaryRetryQueue.queueUrl,
      'URL of the primary retry queue',
      `acorn-pups-primary-retry-queue-url-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/primary-retry-queue/url`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'ManualInterventionQueueUrl',
      this.manualInterventionQueue.queueUrl,
      'URL of the manual intervention queue',
      `acorn-pups-manual-intervention-queue-url-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/manual-intervention-queue/url`
    );

    this.parameterStoreHelper.createOutputWithParameter(
      'AdminAlertTopicArn',
      this.adminAlertTopic.topicArn,
      'ARN of the admin alert SNS topic',
      `acorn-pups-admin-alert-topic-arn-${this.environmentName}`,
      `/acorn-pups/${this.environmentName}/cognito/admin-alert-topic/arn`
    );
  }

  private addResourceTags(): void {
    // Add tags to all resources in the stack
    cdk.Tags.of(this).add('Project', 'acorn-pups');
    cdk.Tags.of(this).add('Environment', this.environmentName);
    cdk.Tags.of(this).add('Component', 'cognito');
  }
} 