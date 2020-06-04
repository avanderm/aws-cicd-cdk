#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import * as external from '../lib/external';
import * as cicd from '../lib/cicd';
import * as service from '../lib/service';

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
    repository: app.node.tryGetContext('dockerRepository'),
    owner: app.node.tryGetContext('owner'),
    artifactBucket: externalResources.artifactBucket
});

let serviceParameters = new Map<string, service.ServiceProps>();

for (let [name, params] of Object.entries(yaml.parse(fs.readFileSync(`./config/${environment}.yml`, 'utf-8')))) {
    serviceParameters.set(name, <service.ServiceProps> params);
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
    mappings: serviceParameters,
    repository: dockerPipeline.imageRepository,
    vpc: externalResources.vpc
});

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
    ecsServices: mainStack.listeningServices,
    artifactBucket: externalResources.artifactBucket
});

// const pipelinePermissions = new cicd.PipelinePermissions(app, 'CicdPipelinePermissions', {
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
//     }
// });

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
    repository: app.node.tryGetContext('cdkRepository'),
    owner: app.node.tryGetContext('owner'),
    branch: 'cdk-pipeline',
    artifactBucket: externalResources.artifactBucket,
    // pipelineDeploymentRole: pipelinePermissions.pipelineDeploymentRole
});

dockerPipeline.addDependency(cdkPipeline);
mainStack.addDependency(cdkPipeline);
ecsPipeline.addDependency(cdkPipeline);