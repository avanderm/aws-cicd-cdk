#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import * as external from '../lib/external';
import * as cicd from '../lib/cicd';
import * as service from '../lib/service';
import { camelCase } from '../lib/utils';

import fs = require('fs');
import yaml = require('yaml');

const environment = process.env.CDK_ENVIRONMENT || 'test';
const account = process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION;

const app = new cdk.App();

const artifactBucket = app.node.tryGetContext('artifactBucket') || `artifacts-${account}-${region}`;
const dockerRepository = app.node.tryGetContext('dockerRepository') || 'aws-cicd-docker';
const cdkRepository = app.node.tryGetContext('cdkRepository') || 'aws-cicd-cdk';
const githubOwner = app.node.tryGetContext('owner') || 'avanderm';
const githubTokenParameter = app.node.tryGetContext('githubTokenParameter') || 'dud';

// already existing resources
const externalResources = new external.ExternalResources(app, 'ExternalResources', {
    env: {
        account: account,
        region: region
    },
    artifactBucket: artifactBucket,
    vpc: app.node.tryGetContext('vpc'),
    subnets: app.node.tryGetContext('subnets')?.split(','),
    availabilityZones: app.node.tryGetContext('availabilityZones')?.split(',')
});

const dockerPipeline = new cicd.DockerStack(app, 'DockerPipeline', {
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
    repository: dockerRepository,
    githubTokenParameter: githubTokenParameter,
    owner: githubOwner,
    artifactBucket: externalResources.artifactBucket
});

let serviceParameters = new Map<string, service.ServiceProps>();

for (let [name, params] of Object.entries(yaml.parse(fs.readFileSync(`./config/${environment}.yml`, 'utf-8')))) {
    serviceParameters.set(camelCase(name), <service.ServiceProps> params);
}

const mainStack = new service.MainStack(app, 'MainStack', {
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
    artifactBucket: externalResources.artifactBucket,
    mappings: serviceParameters,
    repository: dockerPipeline.imageRepository,
    vpc: externalResources.vpc
});

const cdkPipeline = new cicd.CdkStack(app, 'CdkPipeline', {
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
    dockerRepositoryName: dockerRepository,
    cdkRepositoryName: cdkRepository,
    githubTokenParameter: githubTokenParameter,
    owner: githubOwner,
    branch: 'master',
    artifactBucket: externalResources.artifactBucket,
    vpc: externalResources.vpc,
    environment: environment
});

dockerPipeline.addDependency(cdkPipeline);
mainStack.addDependency(cdkPipeline);