import * as ec2 from '@aws-cdk/aws-ec2';

export function formatTableName(topic: string) {
    return topic.toLocaleLowerCase().replace(/\W/gi, '_');
}

export function capitalize(word: string) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

export function camelCase(text: string) {
    return text.split(/[^a-zA-Z0-9]/).map(capitalize).join('');
}

export function getSubnetIds(vpc: ec2.IVpc) {
    let subnets = new Array<string>();

    for (let subnet of vpc.privateSubnets) {
        subnets.push(subnet.subnetId);
    }

    for (let subnet of vpc.publicSubnets) {
        subnets.push(subnet.subnetId);
    }

    return subnets;
}

export function getAvailabilityZones(vpc: ec2.IVpc) {
    return vpc.availabilityZones;
}