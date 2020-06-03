#!/usr/bin/env node
import cdk = require('@aws-cdk/core');
import * as s3 from '@aws-cdk/aws-s3';
import { SharedStack } from '../lib/cicd-shared-stack';
import { CicdDockerStack } from '../lib/cicd-docker-stack';
import { CicdEcsStack } from '../lib/cicd-ecs-stack';

const environment = process.env.CDK_ENVIRONMENT || 'test';
const account = process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION;


const app = new cdk.App();

const artifactBucket = app.node.tryGetContext('ARTIFACT_BUCKET') || `artifacts-${account}-${region}`

const sharedStack = new SharedStack(app, 'SharedStack', {
    env: {
        account: account,
        region: region
    },
    tags: {
        Pillar: 'hs',
        Domain: 'hp',
        Team: 'hp',
        Owner: 'antoine',
        Environment: environment,
        Project: 'CICD'
    },
    artifactBucket: artifactBucket
});

const dockerStack = new CicdDockerStack(app, 'DockerPipeline', {
    env: {
        account: account,
        region: region
    },
    tags: {
        Pillar: 'hs',
        Domain: 'hp',
        Team: 'hp',
        Owner: 'antoine',
        Environment: environment,
        Project: 'CICD'
    },
    repository: app.node.tryGetContext('repository'),
    owner: app.node.tryGetContext('owner'),
    branch: app.node.tryGetContext('branch'),
    // artifactBucket: app.node.tryGetContext('artifactBucket')
    artifactBucket: sharedStack.artifactBucket
});

// new CicdEcsStack(app, 'DeployPipeline', {
//     env: {
//         account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
//         region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
//     },
//     tags: {
//         Pillar: 'hs',
//         Domain: 'hp',
//         Team: 'hp',
//         Owner: 'antoine',
//         Environment: environment,
//         Project: 'CICD'
//     },
//     tag: 'latest',
//     imageRepository: dockerStack.imageRepository,
//     ecsServices: [],
//     artifactBucketName: app.node.tryGetContext('artifactBucket')
// });
