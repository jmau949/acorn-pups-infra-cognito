import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoStackProps, CognitoResources, createDefaultUserPoolConfig, createDefaultLambdaConfig } from './types';
import { ParameterStoreHelper } from './parameter-store-helper';

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolArn: string;
  public readonly postConfirmationLambda: lambda.Function;
  
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

    // Create Cognito resources
    const cognitoResources = this.createCognitoResources(props);
    
    // Assign public properties
    this.userPool = cognitoResources.userPool;
    this.userPoolArn = cognitoResources.userPool.userPoolArn;
    this.postConfirmationLambda = cognitoResources.postConfirmationLambda;

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

    return postConfirmationLambda;
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
  }

  private addResourceTags(): void {
    // Add tags to all resources in the stack
    cdk.Tags.of(this).add('Project', 'acorn-pups');
    cdk.Tags.of(this).add('Environment', this.environmentName);
    cdk.Tags.of(this).add('Component', 'cognito');
  }
} 