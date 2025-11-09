import path from "path";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as iam from "aws-cdk-lib/aws-iam";

export class TextExtractionStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    {
      httpApi,
    }: {
      httpApi: apigatewayv2.HttpApi;
    },
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    const uploadBucket = new s3.Bucket(this, "UploadBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const textExtractionTopic = new sns.Topic(this, "TextExtractionTopic", {
      displayName: "Recipe Text Extraction Topic",
    });

    const fileGatheringFunction = new lambda.Function(
      this,
      "FileGatheringFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handleFileGathering",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda", "file-gathering")
        ),
        environment: {
          S3_BUCKET: uploadBucket.bucketName,
          TEXT_EXTRACTION_TOPIC: textExtractionTopic.topicArn,
        },
        timeout: cdk.Duration.minutes(1),
      }
    );

    uploadBucket.grantRead(fileGatheringFunction);
    textExtractionTopic.grantPublish(fileGatheringFunction);

    const inferenceModelId =
      bedrock.FoundationModelIdentifier.AMAZON_NOVA_PRO_V1_0.modelId;

    const inferenceProfileArn = `arn:aws:bedrock:${props?.env?.region}:${
      props?.env?.account
    }:inference-profile/${
      props?.env?.region?.split("-")[0]
    }.${inferenceModelId}`;

    const inferenceProfile = new bedrock.CfnApplicationInferenceProfile(
      this,
      "InferenceProfile",
      {
        inferenceProfileName: "text-extraction-inference-profile",
        modelSource: {
          copyFrom: inferenceProfileArn,
        },
      }
    );

    const textExtractionFunction = new lambda.Function(
      this,
      "TextExtractionFunction",
      {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: "index.handle_text_extraction",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda", "text-extraction"),
          {
            bundling: {
              image: lambda.Runtime.PYTHON_3_13.bundlingImage,
              command: [
                "bash",
                "-c",
                "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
              ],
            },
          }
        ),
        environment: {
          S3_BUCKET_NAME: uploadBucket.bucketName,
          S3_BUCKET_URL: uploadBucket.s3UrlForObject(),
          S3_BUCKET_OWNER: props?.env?.account || "",
          MODEL_ID: inferenceProfile.attrInferenceProfileArn,
        },
        timeout: cdk.Duration.minutes(3),
      }
    );
    textExtractionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );
    textExtractionTopic.addSubscription(
      new subscriptions.LambdaSubscription(textExtractionFunction)
    );

    uploadBucket.grantReadWrite(textExtractionFunction);

    const textExtractionFunctionIntegration = new HttpLambdaIntegration(
      "TextExtractionFunctionIntegration",
      fileGatheringFunction
    );

    httpApi.addRoutes({
      path: "/extraction/start",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: textExtractionFunctionIntegration,
    });
  }
}
