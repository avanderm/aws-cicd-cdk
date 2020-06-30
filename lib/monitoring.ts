import * as cdk from '@aws-cdk/core';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';

interface DashboardStackProps extends cdk.NestedStackProps {
    metrics: Array<cloudwatch.Metric>;
}

export class DashboardStack extends cdk.NestedStack {
    constructor(scope: cdk.Construct, id: string, props: DashboardStackProps) {
        super(scope, id, props);

        const dashboard = new cloudwatch.Dashboard(this, 'QueueMessages', {
            dashboardName: 'queue-service-messages',
            start: '-24H'
        });

        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Queue Messages',
            left: props.metrics,
            width: 24,
            height: 12
        }));
    }
}