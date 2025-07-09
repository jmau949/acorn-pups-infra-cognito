import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CognitoStack } from '../lib/cognito-stack';

describe('CognitoStack', () => {
  let app: cdk.App;
  
  beforeEach(() => {
    app = new cdk.App();
  });

  test('creates User Pool with basic configuration', () => {
    const stack = new CognitoStack(app, 'TestCognitoStack', {
      environment: 'test',
      usersTableName: 'test-users-table',
      usersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-users-table',
    });

    const template = Template.fromStack(stack);

    // Check User Pool is created with basic properties
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'acorn-pups-test-user-pool',
      AutoVerifiedAttributes: ['email'],
      UsernameAttributes: ['email'],
      MfaConfiguration: 'OFF',
    });

    // Check password policy exists
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: false,
          TemporaryPasswordValidityDays: 7,
        },
      },
    });
  });

  test('creates Lambda function with correct configuration', () => {
    const stack = new CognitoStack(app, 'TestCognitoStack', {
      environment: 'test',
      usersTableName: 'test-users-table',
      usersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-users-table',
    });

    const template = Template.fromStack(stack);

    // Check Lambda function is created
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'acorn-pups-test-post-confirmation',
      Runtime: 'nodejs18.x',
      Handler: 'index.handler',
      Timeout: 5,
      Environment: {
        Variables: {
          USERS_TABLE_NAME: 'test-users-table',
          NODE_ENV: 'test',
        },
      },
    });
  });

  test('creates Parameter Store parameters', () => {
    const stack = new CognitoStack(app, 'TestCognitoStack', {
      environment: 'test',
      usersTableName: 'test-users-table',
      usersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-users-table',
    });

    const template = Template.fromStack(stack);

    // Check Parameter Store parameters are created
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/acorn-pups/test/cognito/user-pool/id',
      Type: 'String',
    });

    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/acorn-pups/test/cognito/user-pool/arn',
      Type: 'String',
    });

    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/acorn-pups/test/cognito/user-pool/name',
      Type: 'String',
    });
  });

  test('creates correct number of resources', () => {
    const stack = new CognitoStack(app, 'TestCognitoStack', {
      environment: 'test',
      usersTableName: 'test-users-table',
      usersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-users-table',
    });

    const template = Template.fromStack(stack);

    // Check that all expected resources are created
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs('AWS::Lambda::Permission', 2); // 2 permissions: Cognito + CloudWatch
    template.resourceCountIs('AWS::SSM::Parameter', 5); // 5 parameters exported
    template.resourceCountIs('AWS::IAM::Role', 1); // Lambda execution role
    template.resourceCountIs('AWS::IAM::Policy', 1); // Lambda policy
  });

  test('has Lambda trigger configured', () => {
    const stack = new CognitoStack(app, 'TestCognitoStack', {
      environment: 'test',
      usersTableName: 'test-users-table',
      usersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-users-table',
    });

    const template = Template.fromStack(stack);

    // Check that User Pool has Lambda trigger configured
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: {
        PostConfirmation: {},
      },
    });

    // Check Lambda permission for Cognito
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'cognito-idp.amazonaws.com',
    });
  });

  test('exports userPool and userPoolArn properties', () => {
    const stack = new CognitoStack(app, 'TestCognitoStack', {
      environment: 'test',
      usersTableName: 'test-users-table',
      usersTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-users-table',
    });

    // Check that the stack has the expected public properties
    expect(stack.userPool).toBeDefined();
    expect(stack.userPoolArn).toBeDefined();
    expect(stack.postConfirmationLambda).toBeDefined();
  });
}); 