import { dirname } from 'path';
import { createWriteStream, stat, rename } from 'fs';

const assert = require('assert');
const mkdirp = require('mkdirp');

import { LogStream } from './logStream';

const defaultOptions = {
  maxBufferLength: 4096, // 日志写入缓存队列最大长度
  flushInterval: 1000, // flush间隔
  logRotator: {
    byHour: true,
    byDay: false,
    hourDelimiter: '_',
  },
};

const onError = (err) => {
  console.error(
    '%s ERROR %s [chair-logger:buffer_write_stream] %s: %s\n%s',
    new Date().toString(),
    process?.pid,
    err?.name,
    err?.message,
    err?.stack,
  );
};

const fileExists = async (srcPath) => {
  return new Promise((resolve) => {
    stat(srcPath, (err, stats) => {
      if (!err && stats.isFile()) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
};

const fileRename = async (oldPath, newPath) => {
  return new Promise((resolve) => {
    rename(oldPath, newPath, (e) => {
      resolve(!e);
    });
  });
};

export class FileStream extends LogStream {
  private options: any = {};
  private _stream = null;
  private _timer = null;
  private _bufSize = 0;
  private _buf = [];
  private lastPlusName = '';
  private _RotateTimer = null;

  constructor(options) {
    super(options);
    assert(options?.fileName, 'should pass options.fileName');
    this.options = Object.assign({}, defaultOptions, options);
    this._stream = null;
    this._timer = null;
    this._bufSize = 0;
    this._buf = [];
    this.lastPlusName = this._getPlusName();
    this.reload();
    this._RotateTimer = this._createRotateInterval();
  }
  log(data) {
    data = this.format(this.jsonParse(data));
    if (data) this._write(data + '\n');
  }

  reload() {
    this.close();
    this._stream = this._createStream();
    this._timer = this._createInterval();
  }

  reloadStream() {
    this._closeStream();
    this._stream = this._createStream();
  }

  close() {
    this._closeInterval();
    if (this._buf && this._buf.length > 0) {
      this.flush();
    }
    this._closeStream();
  }

  end() {
    console.log('transport.end() is deprecated, use transport.close()');
    this.close();
  }

  _write(buf) {
    this._bufSize += buf.length;
    this._buf.push(buf);
    if (this._buf.length > this.options.maxBufferLength) {
      this.flush();
    }
  }

  _createStream() {
    mkdirp.sync(dirname(this.options.fileName));
    const stream = createWriteStream(this.options.fileName, { flags: 'a' });
    stream.on('error', onError);
    return stream;
  }

  _closeStream() {
    if (this._stream) {
      this._stream.end();
      this._stream.removeListener('error', onError);
      this._stream = null;
    }
  }

  flush() {
    if (this._buf.length > 0) {
      this._stream.write(this._buf.join(''));
      this._buf = [];
      this._bufSize = 0;
    }
  }

  _createInterval() {
    return setInterval(() => {
      this.flush();
    }, this.options.flushInterval);
  }

  _closeInterval() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _createRotateInterval() {
    return setInterval(() => {
      this._checkRotate();
    }, 1000);
  }
  _checkRotate() {
    const plusName = this._getPlusName();
    if (plusName === this.lastPlusName) return;
    this.lastPlusName = plusName;
    this.renameOrDelete(this.options.fileName, this.options.fileName + plusName)
      .then(() => {
        this.reloadStream();
      })
      .catch((error) => {
        console.log(error);
        this.reloadStream();
      });
  }

  _getPlusName() {
    let plusName;
    const date = new Date();
    if (this.options.logRotator.byHour) {
      plusName = `${date.getFullYear()}-${
        date.getMonth() + 1
      }-${date.getDate()}${
        this.options.logRotator.hourDelimiter
      }${date.getHours()}`;
    } else {
      plusName = `${date.getFullYear()}-${
        date.getMonth() + 1
      }-${date.getDate()}`;
    }
    return `.${plusName}`;
  }

  async renameOrDelete(srcPath, targetPath) {
    if (srcPath === targetPath) return;
    const srcExists = await fileExists(srcPath);
    if (!srcExists) return;
    const targetExists = await fileExists(targetPath);
    if (targetExists) {
      console.log(`targetFile ${targetPath} exists!!!`);
      return;
    }
    await fileRename(srcPath, targetPath);
  }
}
