import hashlib
import json
import os

import boto3

def upload(file, bucket, build_path, client=boto3.client('s3')):
    parameters = {}

    with open(file) as f:
        assets = json.load(f)

        for asset in assets:
            with open(f'{build_path}/{asset["path"]}', 'rb') as template:
                artifact_hash = hashlib.sha256(template.read()).hexdigest()

            client.upload_file(
                Bucket=bucket,
                Key=f'assets/{asset["id"]}/{artifact_hash}.json',
                Filename=f'{build_path}/{asset["path"]}'
            )

            parameters[asset['s3BucketParameter']] = bucket
            parameters[asset['s3KeyParameter']] = f'assets/{asset["id"]}/||{artifact_hash}.json'
            parameters[asset['artifactHashParameter']] = artifact_hash

    template_configuration = {
        'Parameters': parameters
    }

    with open('mainConfiguration.json', 'w') as f:
        json.dump(template_configuration, f)

if __name__ == '__main__':
    upload(
        'assets.json',
        os.getenv('ARTIFACT_BUCKET'),
        os.getenv('BUILD_DIR')
    )
