import * as cdk from '@aws-cdk/core';
import { ConnectionType, Integration, IntegrationType, RestApi, SecurityPolicy, VpcLink } from '@aws-cdk/aws-apigateway';
import { Bucket } from '@aws-cdk/aws-s3';
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { ContainerImage } from '@aws-cdk/aws-ecs';
import { NetworkLoadBalancedFargateService } from '@aws-cdk/aws-ecs-patterns';
import { Port, SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { BucketDeployment, Source } from '@aws-cdk/aws-s3-deployment';
import { CfnParameter, RemovalPolicy } from '@aws-cdk/core';

export class ServerlessDodPkiExampleStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = new CfnParameter(this, "domainName", {
      type: "String",
      description: "The name of the domain that will be CaC enabled"}
    );

    const domainCertificateARN = new CfnParameter(this, "domainCertificateARN", {
      type: "String",
      description: "The ARN of the domain SSL certificate that has been imported in AWS certificate Manager"}
    );

    const certificateBucket = new Bucket(this, 'truststore-bucket', {
      removalPolicy: RemovalPolicy.DESTROY,
    });
    
    const dodTruststoreDeployment = new BucketDeployment(this, 'dod-truststore-deployment', {
      sources: [Source.asset('./lib/dod-truststore')],
      destinationBucket: certificateBucket,
      retainOnDelete: false,

    });

    const vpc = new Vpc(this, 'CaCEnabledServicesVPC', {});
    
    const loadBalancedFargateService = new NetworkLoadBalancedFargateService(this, 'example-service', {
      vpc,
      memoryLimitMiB: 1024,
      cpu: 512,
      taskImageOptions: {
        image: ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      },
      taskSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_NAT
      },
      publicLoadBalancer: false,
    });

    loadBalancedFargateService.service.connections.allowFromAnyIpv4(Port.allTraffic())

    const cacEnabledRestAPI = new RestApi(this, 'example-api', {
      domainName: {
        certificate: Certificate.fromCertificateArn(this, "domain-cert", domainCertificateARN.valueAsString),
        domainName: domainName.valueAsString,
        securityPolicy: SecurityPolicy.TLS_1_2,
        mtls: {
          bucket: certificateBucket,
          key: "truststore.pem",
        }
      },
    });

    cacEnabledRestAPI.node.addDependency(dodTruststoreDeployment);

    const link = new VpcLink(this, 'example-vpc-link', {
      targets: [loadBalancedFargateService.loadBalancer],
    });
    
    const ecsFargateBackend = new Integration({
      type: IntegrationType.HTTP_PROXY,
      integrationHttpMethod: 'ANY',
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: link,
      },
    });

    cacEnabledRestAPI.root.addMethod('ANY', ecsFargateBackend)

  }
}
