const aws = require("aws-sdk");
const fs = require("fs");
const path = require("path");

aws.config.maxRetries = 6; 

// 增加 HTTP 超时时间至 5 分钟 (300000ms)，以容纳大文件上传所需的时间
aws.config.httpOptions = {
    timeout: 300000,          // 接收响应的超时时间
    connectTimeout: 60000     // 建立连接的超时时间
};

// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html
const s3 = new aws.S3({
  endpoint: new aws.Endpoint(process.env.S3_ENDPOINT),
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
  s3ForcePathStyle: true
});

const options = {
//   partSize: 524288000, // 500 MB in bytes
    partSize: 52428800,
    queueSize: 1
};

const s3Path = process.env.S3_PATH;
const s3Acl = process.env.S3_ACL;
const s3Bucket = process.env.S3_BUCKET;
const contentType = process.env.CONTENT_TYPE;
const publicFiles = process.env.PUBLIC_FILES;

var isUploading = false; 

const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

const formatBytes = (bytes, decimals = 2) => { // https://stackoverflow.com/a/18650828/8542678
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const uploadFile = async (fileName) => {
  if (fileName.includes("*.")) {
    let files = fs.readdirSync(".");
    let filePatterns = fileName.split(",");
    filePatterns.forEach(filePattern => {
      let regex = new RegExp(filePattern.replace('*.', '.*\\.') + '$');
      files.forEach(file => {
        if (regex.test(file)) {
          uploadFile(file);
        }
      });
    });
  }
  else if (fs.lstatSync(fileName).isDirectory()) {
    fs.readdirSync(fileName).forEach((file) => {
      uploadFile(`${fileName}/${file}`);
    });
  }
  else {
    let fileContent = fs.readFileSync(fileName);
    let fileSizeBytes = fileContent.length;

    let s3Key = `${path.normalize(fileName)}`;    
    if (s3Path) {
      s3Key = `${s3Path}${s3Key}`;
    }

    let params = {
      Bucket: s3Bucket,
      Key: s3Key,
      Body: fileContent,
    };
    
    let displayAcl = "private";
    if (s3Acl) {
      params.ACL = s3Acl;
      displayAcl = `${s3Acl}`;
    }
    if (typeof publicFiles === "string" && publicFiles.includes(fileName)) {
      params.ACL = "public-read";
      displayAcl = "public-read";
    }
    
    if (contentType) {
      params.ContentType = contentType;
    }

    while (isUploading) {
      await sleep(100);
      if (process.exitCode > 0) {
        return;
      }
    }

    isUploading = true;

    console.log(`\nUploading: ${fileName} \n\t Size: ${formatBytes(fileSizeBytes, decimals = 1)} \n\t To: s3://${s3Bucket}/${s3Key} \n\t Permissions: ${displayAcl}`);

    let startTime = (new Date()).getTime();

    try {
      let data = await s3.upload(params,options).promise();
      let uploadTimeSec = ((new Date()).getTime() - startTime) / 1000;
      let bytesPerSecond = Math.round(fileSizeBytes / uploadTimeSec);
      console.log(`Completed: ${data.Location} \n\t Speed: ${formatBytes(bytesPerSecond, decimals = 0)}/s`);
      isUploading = false;
    }
catch (err) {
      console.log(`FAILED!`);
      console.error(err); 
      console.log("错误名称:", err.name);
      console.log("错误消息:", err.message);
      console.log("堆栈跟踪:", err.stack);
      process.exit(1);
    }
  }
};

uploadFile(process.env.FILE);
