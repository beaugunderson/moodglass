var redis = require('redis');

exports.setAccessToken = function (userId, accessToken, cb) {
  exports.client.hmset(userId, {
    'accessToken': accessToken,
    'userId': userId
  }, function (err) {
    cb(err);
  });
};

exports.setUser = function (userId, user, cb) {
  exports.client.hmset(userId, user, function (err) {
    cb(err);
  });
};

exports.setLastMood = function (userId, lastMood, cb) {
  exports.client.set('last-mood:' + userId, lastMood, function (err) {
    cb(err);
  });
};

exports.getLastMood = function (userId, cb) {
  exports.client.get('last-mood:' + userId, function (err, lastMood) {
    cb(err, lastMood);
  });
};

exports.getUser = function (userId, cb) {
  exports.client.hgetall(userId, function (err, user) {
    cb(err, user);
  });
};

exports.init = function (cb) {
  exports.client = redis.createClient();

  exports.client.select(12, function (err) {
    cb(err);
  });
};
