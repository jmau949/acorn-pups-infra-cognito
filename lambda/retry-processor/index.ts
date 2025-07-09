import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

// Initialize AWS clients
const dynamoDbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(dynamoDbClient);
const sqs = new SQSClient({});
const cloudwatch = new CloudWatchClient({});
const sns = new SNSClient({});

// Environment variables
const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME!;
const MANUAL_INTERVENTION_QUEUE_URL = process.env.MANUAL_INTERVENTION_QUEUE_URL!;
const ADMIN_ALERT_TOPIC_ARN = process.env.ADMIN_ALERT_TOPIC_ARN!;
const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || '3');

interface UserCreationPayload {
  userRecord: any;
  originalEvent: any;
  attemptCount: number;
  firstAttemptTimestamp: string;
  lastError?: string;
}

/**
 * Retry processor Lambda handler for failed user creation operations
 * Processes messages from the primary retry queue and handles failures gracefully
 */
export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log('Processing retry queue messages:', JSON.stringify(event, null, 2));

  const results = await Promise.allSettled(
    event.Records.map(record => processRetryRecord(record))
  );

  // Log results summary
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`Retry processing complete: ${successful} successful, ${failed} failed`);

  // Publish batch metrics
  await publishBatchMetrics(successful, failed);
};

async function processRetryRecord(record: any): Promise<void> {
  try {
    const payload: UserCreationPayload = JSON.parse(record.body);
    console.log(`Processing retry attempt ${payload.attemptCount} for user creation`);

    // Attempt to create user record in DynamoDB
    await dynamoDb.send(new PutCommand({
      TableName: USERS_TABLE_NAME,
      Item: payload.userRecord,
      ConditionExpression: 'attribute_not_exists(PK)',
    }));

    console.log(`Successfully created user record on retry attempt ${payload.attemptCount}`);

    // Track successful retry
    await publishMetric('UserCreationRetrySuccess', 1, {
      AttemptCount: payload.attemptCount.toString(),
    });

    // Send success notification if this was a recovery after multiple failures
    if (payload.attemptCount > 1) {
      await sendAdminAlert(
        'User Creation Retry Success',
        `User creation succeeded on retry attempt ${payload.attemptCount} for user ${payload.userRecord.user_id}. Original failure time: ${payload.firstAttemptTimestamp}`
      );
    }

  } catch (error) {
    console.error('Retry attempt failed:', error);
    await handleRetryFailure(record, error as Error);
  }
}

async function handleRetryFailure(record: any, error: Error): Promise<void> {
  try {
    const payload: UserCreationPayload = JSON.parse(record.body);
    const newAttemptCount = payload.attemptCount + 1;

    // Track failed retry
    await publishMetric('UserCreationRetryFailure', 1, {
      AttemptCount: payload.attemptCount.toString(),
      ErrorType: error.name || 'Unknown',
    });

    if (newAttemptCount <= MAX_RETRY_ATTEMPTS) {
      // Still within retry limits - send back to retry queue with delay
      console.log(`Retry attempt ${payload.attemptCount} failed, scheduling attempt ${newAttemptCount}`);
      
      const updatedPayload: UserCreationPayload = {
        ...payload,
        attemptCount: newAttemptCount,
        lastError: error.message,
      };

      // Send back to primary retry queue with exponential backoff delay
      const delaySeconds = Math.min(300, Math.pow(2, newAttemptCount) * 30); // Max 5 minutes
      
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.PRIMARY_RETRY_QUEUE_URL!,
        MessageBody: JSON.stringify(updatedPayload),
        DelaySeconds: delaySeconds,
      }));

    } else {
      // Exceeded retry limits - send to manual intervention queue
      console.log(`Max retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded, sending to manual intervention queue`);
      
      const manualPayload = {
        ...payload,
        lastError: error.message,
        finalFailureTimestamp: new Date().toISOString(),
        requiresManualIntervention: true,
      };

      await sqs.send(new SendMessageCommand({
        QueueUrl: MANUAL_INTERVENTION_QUEUE_URL,
        MessageBody: JSON.stringify(manualPayload),
      }));

      // Track manual intervention needed
      await publishMetric('UserCreationManualInterventionRequired', 1);

      // Send admin alert
      await sendAdminAlert(
        'User Creation Requires Manual Intervention',
        `User creation failed after ${MAX_RETRY_ATTEMPTS} retry attempts for user ${payload.userRecord.user_id}. 
        Original attempt: ${payload.firstAttemptTimestamp}
        Final error: ${error.message}
        
        Please check the manual intervention queue for details.`
      );
    }

  } catch (handlingError) {
    console.error('Error handling retry failure:', handlingError);
    // Even the error handling failed - this is a critical issue
    await sendAdminAlert(
      'Critical: Retry Failure Handling Error',
      `Failed to handle retry failure properly. This requires immediate attention.
      Original error: ${error.message}
      Handling error: ${(handlingError as Error).message}`
    );
  }
}

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
  }
}

async function publishBatchMetrics(successful: number, failed: number): Promise<void> {
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'AcornPups/UserRegistration',
      MetricData: [
        {
          MetricName: 'RetryBatchSuccessful',
          Value: successful,
          Unit: 'Count',
          Timestamp: new Date(),
        },
        {
          MetricName: 'RetryBatchFailed',
          Value: failed,
          Unit: 'Count',
          Timestamp: new Date(),
        },
      ],
    }));
  } catch (error) {
    console.error('Failed to publish batch metrics:', error);
  }
}

async function sendAdminAlert(subject: string, message: string): Promise<void> {
  try {
    await sns.send(new PublishCommand({
      TopicArn: ADMIN_ALERT_TOPIC_ARN,
      Subject: `[Acorn Pups] ${subject}`,
      Message: message,
    }));
  } catch (error) {
    console.error('Failed to send admin alert:', error);
  }
}

// Export for testing
export { processRetryRecord, handleRetryFailure, publishMetric, sendAdminAlert }; 