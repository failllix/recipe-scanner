import boto3
import json
import os


s3_client = boto3.client("s3")
bedrock_client = boto3.client("bedrock-runtime")


def handle_text_extraction(event, lambda_context):

    bucket_name = os.environ["S3_BUCKET_NAME"]
    bucket_url = os.environ["S3_BUCKET_URL"]
    bucket_owner = os.environ["S3_BUCKET_OWNER"]

    message = json.loads(event["Records"][0]["Sns"]["Message"])

    language = message["language"]
    folder = message["folder"]
    files = message["files"]

    images = [
        {
            "image": {
                "format": "jpeg",
                "source": {
                    "s3Location": {
                        "uri": f"{bucket_url}/{file}",
                        "bucketOwner": bucket_owner,
                    }
                },
            }
        }
        for file in files
    ]

    system = [
        {
            "text": """You are a helpful extraction expert specialized in extracting information from cooking books. 
            You always make sure to capture all text provided on the images!
            You do not try to make up new words or try to correct anything in the provided texts.
            However, you concatenate words if they are spread across lines and separated with a hyphen (maybe also a space), e.g., "abc- defg" should become "abcdefgh".
            
            You use Markdown for formatting.
            You always make sure to use bulleted lists for ingredients and enumerated lists for instructions.
            For any other texts paragraphs are conserved.
            Your heading levels always start at 1 and are structured meaningfully.

            You are typically looking for the following information:
            - title
            - category
            - cuisine
            - cooking duration
            - ingredients
            - instructions
            - notes

            It's of utmost importance to ensure that all ingredients are included in the answer.

            If any of those information is not given, don't worry just omit such fields.

            Make sure to not include any page numbers.
            """
        }
    ]

    messages = [
        {
            "role": "user",
            "content": [
                *images,
                {
                    "text": f"""I have photographed a recipe from one of my favorite cooking books.
                    Please help me to create a digital Markdown replica.
                    Language used in the images: {language}."""
                },
            ],
        },
    ]

    inf_params = {"maxTokens": 3000, "topP": 0.3, "temperature": 0.2}

    additional_model_request_fields = {"inferenceConfig": {"topK": 30}}

    model_response = bedrock_client.converse(
        modelId=os.environ["MODEL_ID"],
        messages=messages,
        system=system,
        inferenceConfig=inf_params,
        additionalModelRequestFields=additional_model_request_fields,
    )

    print("\n[Response Content Text]")
    print(model_response["output"]["message"]["content"][0]["text"])

    s3_client.put_object(
        Body=model_response["output"]["message"]["content"][0]["text"],
        Bucket=bucket_name,
        Key=f"{folder}SUMMARY.md",
    )
