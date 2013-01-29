var debug = require('debug')('mood');
var express = require('express');
var consolidate = require('consolidate');
var passport = require('passport');
var request = require('request');
var swig = require('swig');

var MongoStore = require('connect-mongo')(express);

require('./lib/passport-strategies');

var users = require('./lib/models/user');

swig.init({
  root: __dirname + '/views',
  allowErrors: true,
  cache: false
});

var app = module.exports.api = express();

app.engine('html', consolidate.swig);

app.set('view engine', 'html');
app.set('views', __dirname + '/views');
app.set('view options', { layout: false });
app.set('view cache', false);

app.use(express.logger());
app.use(express.compress());
app.use(express['static'](__dirname + '/public'));
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({
  secret: process.env.SESSION_SECRET,
  store: new MongoStore({
    db: 'moodglass-sessions'
  })
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(app.router);

app.get('/login', function (req, res) {
  res.render('login');
});

app.get('/auth/google', passport.authenticate('google', {
  accessType: 'offline',
  scope: [
    'https://www.googleapis.com/auth/glass.timeline',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ')
}));

app.get('/auth/google/callback', passport.authenticate('google', {
  failureRedirect: '/glass/login',
  successReturnToOrRedirect: '/glass/'
}));

app.get('/data', function (req, res) {
  // TODO: Display data
  res.render('data');
});

app.get('/', function (req, res) {
  // If the user is logged in then setup a subscription to their timeline
  if (req.user) {
    debug('req.user.accessToken', req.user.accessToken);

    request.post({
      uri: 'https://www.googleapis.com/glass/v1/subscriptions',
      headers: {
        Authorization: 'Bearer ' + req.user.accessToken
      },
      json: {
        collection: 'timeline',
        operation: ['UPDATE', 'INSERT', 'DELETE', 'MENU_ACTION'],
        callbackUrl: 'https://moodglass.com/push/glass',
        verifyToken: 'glass-magic',
        userToken: req.user.userId
      }
    }, function (err, response, body) {
      if (err) debug('err', err);

      debug(JSON.stringify(body, null, 2));
    });
  }

  res.render('index');
});

// This endpoint receives POSTs from Google
app.post('/push/glass', function (req, res) {
  debug('req.body', req.body);

  // Error if Google doesn't send us the correct verifyToken
  if (req.body.verifyToken !== process.env.GOOGLE_VERIFY_TOKEN) {
    return res.send(500);
  }

  // We only care about these three
  if (req.body.operation !== 'INSERT' &&
    req.body.operation !== 'UPDATE' &&
    req.body.operation !== 'MENU_ITEM') {
    return res.send(200);
  }

  // If it's a custom menu action of Good/OK/Bad
  if (req.body.menuActions) {
    // Log this to the database
    debug('body.menuActions', req.body.menuActions);

    if (req.body.menuActions.length !== 1) {
      return res.send(500);
    }

    var mood = parseInt(req.body.menuActions[0].id, 10);

    debug('mood', mood);
  } else {
    users.getUser(req.body.userToken, function (err, user) {
      request.get({
        uri: 'https://www.googleapis.com/glass/v1/timeline/' + req.body.itemId,
        headers: {
          Authorization: 'Bearer ' + user.accessToken
        },
        json: true
      }, function (err, response, body) {
        if (body.text) {
          // Log this to the database
          debug('body.text', body.text);
        }
      });
    });
  }

  res.send(200);
});

// We want exceptions and stracktraces in development
app.configure('development', function () {
  app.use(express.errorHandler({
    dumpExceptions: true,
    showStack: true
  }));
});

// ... but not in production
app.configure('production', function () {
  app.use(express.errorHandler());
});

users.init(function (err) {
  if (err) throw err;

  console.log('Listening on port', process.env.PORT);

  app.listen(process.env.PORT);
});
