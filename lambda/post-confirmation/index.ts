import { PostConfirmationTriggerEvent, PostConfirmationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';

// Initialize AWS clients
const dynamoDbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(dynamoDbClient);
const cloudwatch = new CloudWatchClient({});
const sqs = new SQSClient({});

/**
 * Post-confirmation Lambda handler for Cognito User Pool
 * This function is triggered after a user confirms their email address
 * It attempts to create a user record in DynamoDB, but NEVER fails the trigger
 * Failed operations are sent to a retry queue for processing
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
    const primaryRetryQueueUrl = process.env.PRIMARY_RETRY_QUEUE_URL;
    
    if (!usersTableName) {
      console.error('USERS_TABLE_NAME environment variable is not set');
      await sendToRetryQueue(event, new Error('Missing USERS_TABLE_NAME environment variable'));
      return event; // Never fail the trigger
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

    console.log('Attempting to create user record:', JSON.stringify(userRecord, null, 2));

    try {
      // Attempt to put item in DynamoDB using AWS SDK v3
      await dynamoDb.send(new PutCommand({
        TableName: usersTableName,
        Item: userRecord,
        ConditionExpression: 'attribute_not_exists(PK)', // Ensure we don't overwrite existing records
      }));

      console.log(`Successfully created user record for user: ${userId}`);

      // Track success metrics
      await publishMetric('UserCreationSuccess', 1);
      
    } catch (dynamoError) {
      console.error('DynamoDB operation failed, sending to retry queue:', dynamoError);
      
      // Track immediate failure
      await publishMetric('UserCreationImmediateFailure', 1, {
        ErrorType: (dynamoError as Error).name || 'Unknown',
      });

      // Send to retry queue instead of failing the trigger
      await sendToRetryQueue(event, dynamoError as Error, userRecord);
    }

  } catch (error) {
    console.error('Unexpected error in post-confirmation trigger:', error);
    
    // Log additional context for debugging
    console.error('Event details:', {
      triggerSource: event.triggerSource,
      userPoolId: event.userPoolId,
      userName: event.userName,
      region: event.region,
    });

    // Track unexpected failure
    await publishMetric('UserCreationUnexpectedFailure', 1);

    // Send to retry queue for any unexpected errors
    await sendToRetryQueue(event, error as Error);
  }

  // ALWAYS return the event successfully - never fail the Cognito trigger
  console.log('Post-confirmation trigger completed - user signup will proceed');
  return event;
};

/**
 * Send failed user creation attempt to retry queue
 */
async function sendToRetryQueue(
  originalEvent: PostConfirmationTriggerEvent, 
  error: Error, 
  userRecord?: any
): Promise<void> {
  try {
    const primaryRetryQueueUrl = process.env.PRIMARY_RETRY_QUEUE_URL;
    
    if (!primaryRetryQueueUrl) {
      console.error('PRIMARY_RETRY_QUEUE_URL not configured - cannot send to retry queue');
      return;
    }

    // If we don't have a user record, try to reconstruct it
    if (!userRecord) {
      try {
        const {
          request: { userAttributes },
          userName: cognitoSub,
        } = originalEvent;

        const userId = `usr_${randomUUID()}`;
        const currentTimestamp = new Date().toISOString();

        userRecord = {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          user_id: userId,
          email: userAttributes.email,
          cognito_sub: cognitoSub,
          full_name: userAttributes.name || userAttributes.email,
          phone: userAttributes.phone_number || null,
          timezone: 'America/Los_Angeles',
          created_at: currentTimestamp,
          updated_at: currentTimestamp,
          last_login: null,
          is_active: true,
          push_notifications: true,
          preferred_language: 'en',
          sound_alerts: true,
          vibration_alerts: true,
        };
      } catch (reconstructError) {
        console.error('Failed to reconstruct user record:', reconstructError);
        return;
      }
    }

    const retryPayload = {
      userRecord,
      originalEvent,
      attemptCount: 1,
      firstAttemptTimestamp: new Date().toISOString(),
      lastError: error.message,
    };

    await sqs.send(new SendMessageCommand({
      QueueUrl: primaryRetryQueueUrl,
      MessageBody: JSON.stringify(retryPayload),
      DelaySeconds: 30, // Initial retry delay of 30 seconds
    }));

    console.log('Successfully sent failed user creation to retry queue');
    
    // Track queue send success
    await publishMetric('UserCreationSentToRetryQueue', 1);

  } catch (queueError) {
    console.error('Failed to send to retry queue:', queueError);
    
    // Track queue send failure - this is critical
    await publishMetric('UserCreationRetryQueueSendFailure', 1);
  }
}

/**
 * Publish metrics with error handling
 */
async function publishMetric(metricName: string, value: number, dimensions?: Record<string, string>): Promise<void> {
  try {
    const metricData: any = {
      MetricName: metricName,
      Value: value,
      Unit: 'Count',
      Timestamp: new Date(),
    };

    if (dimensions) {
      metricData.Dimensions = Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }));
    }

    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'AcornPups/UserRegistration',
      MetricData: [metricData],
    }));
  } catch (error) {
    console.error('Failed to publish metric:', error);
    // Don't throw - metrics failure should not impact the main flow
  }
}

// Export for testing
export { dynamoDb, cloudwatch, sqs, sendToRetryQueue, publishMetric }; 