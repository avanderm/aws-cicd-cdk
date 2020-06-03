#!/usr/bin/env node
import cdk = require('@aws-cdk/core');
import { CicdDockerStack } from '../lib/cicd-docker-stack';

const environment = process.env.CDK_ENVIRONMENT || 'test';

const app = new cdk.App();

new CicdDockerStack(app, 'DockerPipeline', {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
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
    branch: app.node.tryGetContext('branch')
});
