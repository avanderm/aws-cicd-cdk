#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as ecs from '@aws-cdk/aws-ecs';
import * as external from '../lib/external';
import * as cicd from '../lib/cicd';
import * as service from '../lib/service';
import * as monitoring from '../lib/monitoring';
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

const mainStack = new service.BaseStack(app, 'BaseStack', {
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
    vpc: externalResources.vpc
});

let services = new Map<string, ecs.BaseService>();
let metrics = new Array<cloudwatch.Metric>();

for (let [name, params] of Object.entries(yaml.parse(fs.readFileSync(`./config/${environment}.yml`, 'utf-8')))) {
    let serviceStack = new service.QueueServiceStack(app, `QueueService-${camelCase(name)}`, {
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
        cluster: mainStack.cluster,
        logGroup: mainStack.logGroup,
        parameters: <service.ServiceProps> params,
        repository: dockerPipeline.imageRepository
    });

    services.set(camelCase(name), serviceStack.service);
    metrics.push(serviceStack.metric);
}

const ecsPipeline = new cicd.EcsStack(app, 'DeployPipeline', {
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
    imageRepositoryName: dockerPipeline.imageRepository.repositoryName,
    ecsServices: services,
    cluster: mainStack.cluster,
    artifactBucket: externalResources.artifactBucket
});

new monitoring.DashboardStack(app, 'DashBoardStack', {
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
    metrics: metrics
})

const cdkPipeline = new cicd.CdkStack(app, 'CdkPipeline', {
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
    dockerRepositoryName: dockerRepository,
    cdkRepositoryName: cdkRepository,
    githubTokenParameter: githubTokenParameter,
    owner: githubOwner,
    branch: 'parametrization',
    artifactBucket: externalResources.artifactBucket,
    vpc: externalResources.vpc,
    environment: environment
});

// dockerPipeline.addDependency(cdkPipeline);
// mainStack.addDependency(cdkPipeline);