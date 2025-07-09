import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Common configuration interface for all stacks
 */
export interface BaseStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Configuration for Cognito stack
 */
export interface CognitoStackProps extends BaseStackProps {
  usersTableName: string;
  usersTableArn: string;
  env?: cdk.Environment;
}

/**
 * Configuration for the post-confirmation Lambda function
 */
export interface PostConfirmationLambdaConfig {
  functionName: string;
  timeout: cdk.Duration;
  runtime: lambda.Runtime;
  usersTableName: string;
  usersTableArn: string;
}

/**
 * Cognito User Pool configuration
 */
export interface UserPoolConfig {
  userPoolName: string;
  selfSignUpEnabled: boolean;
  signInAliases: {
    email: boolean;
    username: boolean;
  };
  autoVerify: {
    email: boolean;
    phone: boolean;
  };
  mfaConfiguration: cognito.Mfa;
  accountRecovery: cognito.AccountRecovery;
  standardAttributes: {
    email: {
      required: boolean;
      mutable: boolean;
    };
    fullname: {
      required: boolean;
      mutable: boolean;
    };
  };
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireDigits: boolean;
    requireSymbols: boolean;
    tempPasswordValidity: cdk.Duration;
  };
}

/**
 * Cognito resources interface
 */
export interface CognitoResources {
  userPool: cognito.UserPool;
  postConfirmationLambda: lambda.Function;
}

/**
 * Environment configuration
 */
export interface EnvironmentConfig {
  environment: string;
  isDevelopment: boolean;
  isProduction: boolean;
  lambdaTimeout: cdk.Duration;
  enableDetailedMonitoring: boolean;
  enableAlarms: boolean;
}

/**
 * Create environment-specific configuration
 */
export const createEnvironmentConfig = (environment: string): EnvironmentConfig => ({
  environment,
  isDevelopment: environment === 'dev',
  isProduction: environment === 'prod',
  lambdaTimeout: cdk.Duration.seconds(5),
  enableDetailedMonitoring: environment === 'prod',
  enableAlarms: environment === 'prod',
});

/**
 * Create default User Pool configuration
 */
export const createDefaultUserPoolConfig = (environment: string): UserPoolConfig => ({
  userPoolName: `acorn-pups-${environment}-user-pool`,
  selfSignUpEnabled: true,
  signInAliases: {
    email: true,
    username: false,
  },
  autoVerify: {
    email: true,
    phone: false,
  },
  mfaConfiguration: cognito.Mfa.OFF,
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  standardAttributes: {
    email: {
      required: true,
      mutable: false,
    },
    fullname: {
      required: true,
      mutable: true,
    },
  },
  passwordPolicy: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireDigits: true,
    requireSymbols: false,
    tempPasswordValidity: cdk.Duration.days(7),
  },
});

/**
 * Create default Lambda configuration
 */
export const createDefaultLambdaConfig = (
  environment: string,
  usersTableName: string,
  usersTableArn: string
): PostConfirmationLambdaConfig => ({
  functionName: `acorn-pups-${environment}-post-confirmation`,
  timeout: cdk.Duration.seconds(5),
  runtime: lambda.Runtime.NODEJS_18_X,
  usersTableName,
  usersTableArn,
}); 