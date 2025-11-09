const { S3Client, paginateListObjectsV2 } = require("@aws-sdk/client-s3");
const { PublishCommand, SNSClient } = require("@aws-sdk/client-sns");

const s3Client = new S3Client();
const snsClient = new SNSClient();

async function handleFileGathering(event) {
  try {
    const body = JSON.parse(event.body);

    const folder = body.folder.endsWith("/") ? body.folder : body.folder + "/";
    const language = body.language;

    const paginator = paginateListObjectsV2(
      { client: s3Client, pageSize: 10 },
      { Bucket: process.env.S3_BUCKET, Prefix: folder }
    );

    const files = [];
    for await (const page of paginator) {
      const images = page.Contents.map((object) => object.Key).filter((key) =>
        key.endsWith("jpg")
      );
      files.push(...images);
    }

    console.log(`Found files for folder "${folder}": ${files}`);

    if (files.length === 0) {
      return {
        statusCode: 404,
      };
    }

    const messageBody = { folder, files, language };

    console.log("Sending message body to queue:", messageBody);

    const response = await snsClient.send(
      new PublishCommand({
        Message: JSON.stringify(messageBody),
        TopicArn: process.env.TEXT_EXTRACTION_TOPIC,
      })
    );

    console.log(response);

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error("Publishing message failed");
    }

    return {
      statusCode: 202,
    };
  } catch (err) {
    console.log(err);
    return {
      statusCode: 500,
      body: "Internal Server Error",
    };
  }
}

module.exports = { handleFileGathering };
