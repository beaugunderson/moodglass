var debug = require('debug')('passport');
var passport = require('passport');
var GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;

var users = require('./models/user');

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  users.getUser(id, function (err, user) {
    done(err, user);
  });
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_REDIRECT_URI
  },
  function (accessToken, refreshToken, profile, done) {
    debug('userId', profile.id);
    debug('accessToken', accessToken);
    debug('refreshToken', refreshToken);

    var data = {
      userId: profile.id,
      accessToken: accessToken
    };

    if (refreshToken) {
      data.refreshToken = refreshToken;
    }

    users.setUser(profile.id, data, function (err) {
      done(err, {
        id: profile.id,
        _id: profile.id,
        accessToken: accessToken,
        refreshToken: refreshToken
      });
    });
  }
));
