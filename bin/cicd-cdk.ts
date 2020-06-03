#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import { SharedStack } from '../lib/cicd-shared-stack';
import { CicdDockerStack } from '../lib/cicd-docker-stack';
import { CicdEcsStack } from '../lib/cicd-ecs-stack';
import { BaseResources, QueueService } from '../lib/service';

import { camelCase } from '../lib/utils';
import fs = require('fs');
import yaml = require('yaml');
import { EcrImage } from '@aws-cdk/aws-ecs';

const environment = process.env.CDK_ENVIRONMENT || 'test';
const account = process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION;

const app = new cdk.App();

const artifactBucket = app.node.tryGetContext('artifactBucket') || `artifacts-${account}-${region}`

const baseResources = new BaseResources(app, 'BaseResources', {
    env: {
        account: account,
        region: region
    }
});

const shared = new SharedStack(app, 'SharedStack', {
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

const dockerPipeline = new CicdDockerStack(app, 'DockerPipeline', {
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
    artifactBucket: shared.artifactBucket
});

// var processorStacks: Array<QueueService> = [];
var processorServices: Map<string, ecs.BaseService> = new Map();

var processors = yaml.parse(fs.readFileSync(`./config/${environment}.yml`, 'utf-8'));
for (let processor in processors) {
    let parameters = processors[processor];

    let processorStack = new QueueService(app, `QueueService-${camelCase(processor)}`, {
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

    // processorStacks.push(processorStack);
    processorServices.set(camelCase(processor), processorStack.service);
}

const deployPipeline = new CicdEcsStack(app, 'DeployPipeline', {
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
    artifactBucket: shared.artifactBucket
});