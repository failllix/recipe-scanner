import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as cognito from "aws-cdk-lib/aws-cognito";

export class AuthStack extends cdk.Stack {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "RecipeScannerUserPool", {
      selfSignUpEnabled: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      signInAliases: {
        email: true,
        username: false,
        phone: false,
        preferredUsername: false,
      },
      userInvitation: {
        emailSubject: "Invite to join the recipe scanner app",
        emailBody:
          "Hello {username}, you have been invited to join the recipe scanner app! Your temporary password is: {####}",
      },
    });

    new cognito.CfnUserPoolGroup(this, "RecipeScannerAdminPoolGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "admin",
    });

    new cognito.CfnUserPoolGroup(this, "RecipeScannerUserPoolGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "user",
    });

    this.userPoolClient = this.userPool.addClient("test-client", {
      generateSecret: true,
      oAuth: {
        callbackUrls: ["http://localhost:1234/foo"],
      },
    });

    new cognito.CfnManagedLoginBranding(
      this,
      "TestClinetManagedLoginBranding",
      {
        userPoolId: this.userPool.userPoolId,
        clientId: this.userPoolClient.userPoolClientId,
        returnMergedResources: true,
        useCognitoProvidedValues: true,
      }
    );

    const userPoolDomain = this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: "recipe-scanner" },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    new cdk.CfnOutput(this, "Cognito Domain", {
      value: userPoolDomain.baseUrl(),
      description: "Base URL of the Cognito User Pool",
    });

    new cdk.CfnOutput(this, "Test Client ID", {
      value: this.userPoolClient.userPoolClientId,
      description: "Client ID of the test client.",
    });

    new cdk.CfnOutput(this, "Test Client Secret", {
      value: this.userPoolClient.userPoolClientSecret.unsafeUnwrap(),
      description: "Client Secret of the test client.",
    });
  }
}
