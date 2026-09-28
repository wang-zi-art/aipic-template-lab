/**
 * 腾讯 COS 临时票据上传适配器。
 *
 * 适配器只接收管理员 API 签发的单对象短期凭据，不读取长期密钥，也不向日志暴露供应商错误。
 */
import COS from 'cos-nodejs-sdk-v5';
import { McpOperationError } from './errors.js';

/** 两类现有上传接口共用的最小短期票据形状。 */
export interface TemporaryCosUploadTicket {
  storage: { bucket: string; region: string; objectKey: string };
  credentials: {
    temporarySecretId: string;
    temporarySecretKey: string;
    sessionToken: string;
  };
}

export interface TemplateAssetUploader {
  upload(ticket: TemporaryCosUploadTicket, bytes: Buffer, contentType: string): Promise<void>;
}

/** 创建使用单次临时客户端的 COS 上传器，完成后不保留票据或图片内容。 */
export function createTencentCosAssetUploader(): TemplateAssetUploader {
  return {
    /** 将文件原样写入服务端票据指定的 Bucket、Region 和 Key。 */
    async upload(ticket, bytes, contentType) {
      const client = new COS({
        SecretId: ticket.credentials.temporarySecretId,
        SecretKey: ticket.credentials.temporarySecretKey,
        SecurityToken: ticket.credentials.sessionToken,
      });
      try {
        await client.putObject({
          Bucket: ticket.storage.bucket,
          Region: ticket.storage.region,
          Key: ticket.storage.objectKey,
          Body: bytes,
          ContentType: contentType,
        });
      } catch {
        throw new McpOperationError('COS_UPLOAD_FAILED', '图片直传对象存储失败', true);
      }
    },
  };
}
