var consolidate = require('consolidate');
var debug = require('debug')('mood');
var express = require('express');
var gdata = require('gdata-js');
var passport = require('passport');
var swig = require('swig');

var Firebase = require('./ext/firebase-node');

var MongoStore = require('connect-mongo')(express);

require('./lib/passport-strategies');

var users = require('./lib/models/user');

swig.init({
  root: __dirname + '/views',
  allowErrors: true,
  cache: false
});

function timelineTemplate() {
  return {
    "creator": {
      "kind": "glass#entity",
      "source": "moodmeter",
      "displayName": "Moodglass",
      "imageUrls": [
        "https://www.moodglass.com/img/moodglass-128.png"
      ],
      "type": "INDIVIDUAL"
    },
    "menuItems": [
      { "id": 3, "action": "CUSTOM",
        "values": [{ "state": "DEFAULT",
          "displayName": "Good",
          "iconUrl": "https://beaugunderson.com/glass/img/green-full.png" }] },
      { "id": 2, "action": "CUSTOM",
        "values": [{ "state": "DEFAULT",
          "displayName": "Neutral",
          "iconUrl": "https://beaugunderson.com/glass/img/yellow-full.png" }] },
      { "id": 1, "action": "CUSTOM",
        "values": [{ "state": "DEFAULT",
          "displayName": "Bad",
          "iconUrl": "https://beaugunderson.com/glass/img/red-full.png" }] },
      { "id": "reply", "action": "REPLY" }
    ],
    "html": "<article>\n  <section>\n    <h1 class=\"text-large green\">How are you feeling?</h1>\n    <p>Your last mood was <em class=\"green\">good</em>. Please rate your current mood.</p>\n  </section>\n</article>"
  };
}

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

function google(accessToken, refreshToken) {
  var client = gdata(process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET);

  client.setToken({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  return client;
}

app.use(function (req, res, next) {
  req.google = function () {
    return google(req.user.accessToken, req.user.refreshToken);
  };

  next();
});

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
  failureRedirect: '/login',
  successReturnToOrRedirect: '/'
}));

// TODO: ensureLoggedIn
app.get('/data', function (req, res) {
  res.render('data', { userId: req.user.userId });
});

// TODO: ensureLoggedIn
app.get('/trigger', function (req, res) {
  req.google().post({
    uri: 'https://www.googleapis.com/glass/v1/timeline',
    json: timelineTemplate()
  }, function (err, body) {
    res.json(body);
  });
});

app.get('/', function (req, res) {
  // If the user is logged in then setup a subscription to their timeline
  if (req.user) {
    req.google().post({
      uri: 'https://www.googleapis.com/glass/v1/subscriptions',
      json: {
        collection: 'timeline',
        operation: ['UPDATE', 'INSERT', 'DELETE', 'MENU_ACTION'],
        callbackUrl: 'https://moodglass.com/push/glass',
        verifyToken: 'glass-magic',
        userToken: req.user.userId
      }
    }, function (err, body) {
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

  var ref = new Firebase('https://moodglass.firebaseio.com/data/' +
    req.body.userToken);

  debug('Attempting to service POST');

  // If it's a custom menu action of Good/Neutral/Bad
  if (req.body.menuActions) {
    if (req.body.menuActions.length !== 1) {
      return res.send(500);
    }

    var mood = parseInt(req.body.menuActions[0].id, 10);

    ref.push({ timestamp: Date.now(), mood: mood });
  } else {
    users.getUser(req.body.userToken, function (err, user) {
      if (err) return;

      google(user.accessToken, user.refreshToken).getFeed({
        uri: 'https://www.googleapis.com/glass/v1/timeline/' + req.body.itemId,
        json: true
      }, function (err, body) {
        debug('err', err);
        debug('body', body);

        if (err) return;

        if (body.text) {
          // Retrieve the last record
          var onLastElement = ref.endAt().limit(1).on('child_added',
            function (snapshot) {
            var name = snapshot.name();
            var val = snapshot.val();

            val.notes = body.text;

            debug('snapshot.name()', name);
            debug('snapshot.val()', val);

            ref.child(name).update(val);

            ref.off('child_added', onLastElement);
          });
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
