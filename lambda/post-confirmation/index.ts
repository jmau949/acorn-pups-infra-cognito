import { PostConfirmationTriggerEvent, PostConfirmationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { randomUUID } from 'crypto';

// Initialize AWS clients
const dynamoDbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(dynamoDbClient);
const cloudwatch = new CloudWatchClient({});

/**
 * Post-confirmation Lambda handler for Cognito User Pool
 * This function is triggered after a user confirms their email address
 * It creates a user record in the DynamoDB users table
 */
export const handler: PostConfirmationTriggerHandler = async (event: PostConfirmationTriggerEvent) => {
  console.log('Post-confirmation trigger event:', JSON.stringify(event, null, 2));

  try {
    // Extract user details from Cognito event
    const {
      request: { userAttributes },
      userName: cognitoSub,
    } = event;

    // Get environment variables
    const usersTableName = process.env.USERS_TABLE_NAME;
    if (!usersTableName) {
      throw new Error('USERS_TABLE_NAME environment variable is not set');
    }

    // Generate user ID using crypto.randomUUID for better uniqueness
    const userId = `usr_${randomUUID()}`;

    // Generate ISO date string once and reuse
    const currentTimestamp = new Date().toISOString();

    // Create user record in DynamoDB
    const userRecord = {
      PK: `USER#${userId}`,
      SK: 'PROFILE',
      user_id: userId,
      email: userAttributes.email,
      cognito_sub: cognitoSub,
      full_name: userAttributes.name || userAttributes.email,
      phone: userAttributes.phone_number || null,
      timezone: 'America/Los_Angeles', // Default to Pacific timezone
      created_at: currentTimestamp,
      updated_at: currentTimestamp,
      last_login: null,
      is_active: true,
      push_notifications: true,
      preferred_language: 'en',
      sound_alerts: true,
      vibration_alerts: true,
    };

    console.log('Creating user record:', JSON.stringify(userRecord, null, 2));

    // Put item in DynamoDB using AWS SDK v3
    await dynamoDb.send(new PutCommand({
      TableName: usersTableName,
      Item: userRecord,
      ConditionExpression: 'attribute_not_exists(PK)', // Ensure we don't overwrite existing records
    }));

    console.log(`Successfully created user record for user: ${userId}`);

    // Add custom metrics for monitoring
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'AcornPups/UserRegistration',
      MetricData: [{
        MetricName: 'UserCreationSuccess',
        Value: 1,
        Unit: 'Count',
        Timestamp: new Date(),
      }]
    }));

    // Return the event unchanged (required for Cognito triggers)
    return event;

  } catch (error) {
    console.error('Error in post-confirmation trigger:', error);
    
    // Log additional context for debugging
    console.error('Event details:', {
      triggerSource: event.triggerSource,
      userPoolId: event.userPoolId,
      userName: event.userName,
      region: event.region,
    });

    // Track failure metrics
    try {
      await cloudwatch.send(new PutMetricDataCommand({
        Namespace: 'AcornPups/UserRegistration',
        MetricData: [{
          MetricName: 'UserCreationFailure',
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date(),
        }]
      }));
    } catch (metricError) {
      console.error('Failed to send failure metric:', metricError);
    }

    // Re-throw the error to fail the trigger
    // This will prevent the user from being confirmed if there's an issue
    throw error;
  }
};

// Export for testing
export { dynamoDb, cloudwatch }; 