import * as path from "path";
import {
  CustomResource,
  Duration,
  Stack,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_cognito as cognito,
} from "aws-cdk-lib";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

export interface IOauthClientParamaterStoreSecretProps {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  parameterName: string;
}

export class OauthClientParameterStoreSecret extends Construct {
  private readonly parameterName: string;

  constructor(
    scope: Construct,
    id: string,
    props: IOauthClientParamaterStoreSecretProps
  ) {
    super(scope, id);

    const oauthClientStorageProvider =
      OauthClientStorageProvider.getOrCreate(this);

    const customResource = new CustomResource(
      this,
      "CustomParameterStoreOauthClient",
      {
        serviceToken: oauthClientStorageProvider.serviceToken,
        resourceType: "Custom::CustomParameterStoreOauthClient",
        properties: {
          UserPoolId: props.userPool.userPoolId,
          ClientId: props.userPoolClient.userPoolClientId,
          ParameterName: props.parameterName,
        },
      }
    );

    const stack = Stack.of(this);

    oauthClientStorageProvider.onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:DescribeUserPoolClient"],
        resources: [props.userPool.userPoolArn],
      })
    );

    this.parameterName = `arn:aws:ssm:${stack.region}:${
      stack.account
    }:parameter/${props.parameterName.replace(/^\//, "")}`;

    oauthClientStorageProvider.onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:AddTagsToResource",
        ],
        resources: [this.parameterName],
      })
    );

    customResource.node.addDependency(props.userPoolClient);
  }

  grantRead(grantee: iam.IGrantable): iam.Grant {
    const result = iam.Grant.addToPrincipal({
      grantee,
      actions: ["ssm:GetParameter", "ssm:GetParameters"],
      resourceArns: [this.parameterName],
    });

    return result;
  }
}

class OauthClientStorageProvider extends Construct {
  public readonly provider: Provider;
  static providerId = "OAuthClientStorageProvider";

  private constructor(scope: Construct, id: string) {
    super(scope, id);

    const handler = new lambda.Function(
      this,
      "OAuthClientStorageProviderHandler",
      {
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../lambda/oauth-client-to-parameter-store")
        ),
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.fetchOAuthClientAndStoreInParameterStore",
        timeout: Duration.seconds(30),
      }
    );

    this.provider = new Provider(this, OauthClientStorageProvider.providerId, {
      onEventHandler: handler,
    });
  }

  public static getOrCreate(scope: Construct): Provider {
    const stack = Stack.of(scope);
    const existing = stack.node.tryFindChild(
      this.providerId
    ) as OauthClientStorageProvider;
    if (existing) return existing.provider;
    return new OauthClientStorageProvider(stack, this.providerId).provider;
  }
}
