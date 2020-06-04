#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
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

const artifactBucket = app.node.tryGetContext('artifactBucket') || `artifacts-${account}-${region}`

// already existing resources
const externalResources = new external.ExternalResources(app, 'ExternalResources', {
    env: {
        account: account,
        region: region
    },
    artifactBucket: artifactBucket
});

// shared resources among non-CI/CD stacks
const baseResources = new service.BaseResources(app, 'BaseResources', {
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
    vpc: externalResources.vpc
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
    repository: app.node.tryGetContext('repository'),
    owner: app.node.tryGetContext('owner'),
    branch: app.node.tryGetContext('branch'),
    artifactBucket: externalResources.artifactBucket
});

var processorServices: Map<string, ecs.BaseService> = new Map();

var processors = yaml.parse(fs.readFileSync(`./config/${environment}.yml`, 'utf-8'));
for (let processor in processors) {
    let parameters = processors[processor];

    let processorStack = new service.QueueService(app, `QueueService-${camelCase(processor)}`, {
        env: {
            account: account,
            region: region
        },
        repository: dockerPipeline.imageRepository,
        tag: parameters.version,
        logGroup: baseResources.logGroup,
        cluster: baseResources.cluster,
        ageRestriction: parameters.ageRestriction
    });

    processorServices.set(camelCase(processor), processorStack.service);
}

const deployPipeline = new cicd.EcsStack(app, 'DeployPipeline', {
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
    tag: 'latest',
    imageRepositoryName: dockerPipeline.imageRepository.repositoryName,
    ecsServices: processorServices,
    artifactBucket: externalResources.artifactBucket
});