const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

let configuration;

async function getConfiguration() {
  if (configuration != undefined) {
    return configuration;
  }
  const client = new SSMClient();
  const response = await client.send(
    new GetParametersCommand({
      Names: [
        "RecipeScannerFrontendClientSecret",
        "RecipeScannerFrontendClientId",
        "RecipeScannerFrontendRedirectUri",
        "RecipeScannerFrontendAuthorizationBaseUrl",
      ],
      WithDecryption: true,
    })
  );

  const parameters = response.Parameters ?? [];

  configuration = {
    CLIENT_SECRET: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendClientSecret";
    }).Value,
    CLIENT_ID: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendClientId";
    }).Value,
    REDIRECT_URI: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendRedirectUri";
    }).Value,
    AUTHORIZATION_BASE_URL: parameters.find((curr) => {
      return curr.Name == "RecipeScannerFrontendAuthorizationBaseUrl";
    }).Value,
  };

  return configuration;
}

async function handleFrontendLogin(event) {
  const request = event.Records[0].cf.request;
  console.log("Received request:");

  console.dir(request, { depth: 200 });

  params = new URLSearchParams(request.querystring);

  const code = params.get("code");

  if (!code) {
    return { status: 500, body: "Missing code to fetch access token." };
  }

  const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, AUTHORIZATION_BASE_URL } =
    await getConfiguration();

  const tokenResponse = await fetch(`${AUTHORIZATION_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });

  const { access_token: accessToken } = await tokenResponse.json();

  let requestedUri = "/";

  try {
    const parsedState = JSON.parse(
      atob(decodeURIComponent(params.get("state")))
    );
    requestedUri = parsedState.requestedUri ?? "/";
  } catch (e) {}

  return {
    status: 307,
    headers: {
      location: [
        {
          key: "Location",
          value: requestedUri,
        },
      ],
      "set-cookie": [
        {
          key: "Set-Cookie",
          value: `accessToken=${accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/`,
        },
      ],
    },
  };
}

module.exports = { handleFrontendLogin };
