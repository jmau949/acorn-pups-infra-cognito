#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { CognitoStack } from '../lib/cognito-stack';

const app = new cdk.App();

// Get environment from context (dev or prod)
const environment = app.node.tryGetContext('environment') || 'dev';
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

console.log(`Deploying Cognito infrastructure to environment: ${environment}`);

const env = {
  account,
  region,
};

/**
 * Retrieve DynamoDB table information from Parameter Store
 * This assumes the DB infrastructure has already been deployed
 */
async function getDbTableInfo() {
  const ssmClient = new SSMClient({ region });
  
  try {
    // Get users table name from Parameter Store
    const usersTableNameParam = await ssmClient.send(new GetParameterCommand({
      Name: `/acorn-pups/${environment}/dynamodb-tables/users/name`,
    }));
    
    // Get users table ARN from Parameter Store
    const usersTableArnParam = await ssmClient.send(new GetParameterCommand({
      Name: `/acorn-pups/${environment}/dynamodb-tables/users/arn`,
    }));

    if (!usersTableNameParam.Parameter?.Value || !usersTableArnParam.Parameter?.Value) {
      throw new Error('Failed to retrieve users table information from Parameter Store');
    }

    return {
      usersTableName: usersTableNameParam.Parameter.Value,
      usersTableArn: usersTableArnParam.Parameter.Value,
    };
  } catch (error) {
    console.error('Error retrieving DB table info from Parameter Store:', error);
    console.error('Make sure the acorn-pups-infra-db stack has been deployed first.');
    throw error;
  }
}

// Main deployment function
async function main() {
  // Get DB table information
  const dbInfo = await getDbTableInfo();
  
  // Stack naming convention
  const stackPrefix = `acorn-pups-${environment}`;
  
  // Cognito Stack
  const cognitoStack = new CognitoStack(app, `${stackPrefix}-cognito`, {
    env,
    environment,
    usersTableName: dbInfo.usersTableName,
    usersTableArn: dbInfo.usersTableArn,
  });

  // Tags for all resources
  cdk.Tags.of(app).add('Project', 'acorn-pups');
  cdk.Tags.of(app).add('Environment', environment);
  cdk.Tags.of(app).add('Service', 'Authentication');
  cdk.Tags.of(app).add('ManagedBy', 'CDK');
}

// Run the main function
main().catch(error => {
  console.error('Failed to deploy:', error);
  process.exit(1);
}); 