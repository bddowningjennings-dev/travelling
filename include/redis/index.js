const config = require('../utils/config');
const misc = require('../utils/misc');

const MemoryStore = require('./memory/sessionstore');
const RedisMemoryStore = require('./sessionstore');

const TokenStore = require('./memory/tokenstore');
const RedisTokenStore = require('./tokenstore');

const IORedis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

class Redis {
  constructor() {
    if (config.redis.enable) {
      this.redis = new IORedis(config.redis.url);
      this.tokenStore = new RedisTokenStore(this.redis);
      this.sessionStore = new RedisMemoryStore(this.redis);

      // Sub
      this.redisSub = new IORedis(config.redis.events.url);

      this.redisSub.subscribe('groupUpdate');

      this.redisSub.on('message', (channel, message) => {
        if (this[channel]) {
          var msg = message.split(':');

          if (msg[0] != this.redisPub.uuid) {
            this[channel](msg[1]);
          }
        }
      });

      // Pub
      this.redisPub = new IORedis(config.redis.events.url);
      this.redisPub.uuid = uuidv4();
    } else {
      this.tokenStore = new TokenStore();
      this.sessionStore = new MemoryStore();
    }

    this._needsGroupUpdate = true;
  }

  get needsGroupUpdate() {
    // config.log.logger.debug('Get NeedsGroupUpdate', this._needsGroupUpdate);
    return this._needsGroupUpdate;
  }

  set needsGroupUpdate(value) {
    this._needsGroupUpdate = value;
    // config.log.logger.debug('Set NeedsGroupUpdate', this._needsGroupUpdate);
    if (config.redis.enable && value) {
      this.redisPub.publish('groupUpdate', `${this.redisPub.uuid}:${value}`);
    }
    return this._needsGroupUpdate;
  }

  groupUpdate(msg) {
    config.log.logger.debug('Group update message received');
    this._needsGroupUpdate = misc.stringToBool(msg);
  }

  async flushAll() {
    if (this.redis) {
      await this.redis.flushall();
    }
  }
}
const redis = new Redis();

module.exports = redis;
