var consolidate = require('consolidate');
var debug = require('debug')('mood');
var express = require('express');
var gdata = require('gdata-js');
var passport = require('passport');
var request = require('request');
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

//var THIRTY_MINUTES = 30 * 60 * 1000;
var THIRTY_MINUTES = 10 * 1000;

var MOODS = {
  1: 'Bad',
  3: 'Neutral',
  5: 'Good'
};

var COLORS = {
  1: 'red',
  3: 'yellow',
  5: 'green'
};

function timelineTemplate(opt_lastMood) {
  var lastMood = '';

  if (opt_lastMood) {
    lastMood = 'Your last mood was <em class="' + COLORS[opt_lastMood] +
      '">' + MOODS[opt_lastMood].toLowerCase() + '</em>. ';
  }

  return {
    "creator": {
      "kind": "glass#entity",
      "source": "moodmeter",
      "displayName": "Moodglass",
      "imageUrls": [
        "https://www.moodglass.com/img/brain-logo.png"
      ],
      "type": "INDIVIDUAL"
    },
    "menuItems": [
      { "id": 5, "action": "CUSTOM",
        "values": [{ "state": "DEFAULT",
          "displayName": "Good",
          "iconUrl": "https://beaugunderson.com/glass/img/green-full.png" }] },
      { "id": 3, "action": "CUSTOM",
        "values": [{ "state": "DEFAULT",
          "displayName": "Neutral",
          "iconUrl": "https://beaugunderson.com/glass/img/yellow-full.png" }] },
      { "id": 1, "action": "CUSTOM",
        "values": [{ "state": "DEFAULT",
          "displayName": "Bad",
          "iconUrl": "https://beaugunderson.com/glass/img/red-full.png" }] },
      { "id": "reply", "action": "REPLY" }
    ],
    "html": '<article><section>' +
      '<h1 class="text-large green">How are you feeling?</h1>' + lastMood +
      'Please rate your current mood.</p></section></article>'
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

app.use(function (req, res, next) {
  res.locals.user = req.user;
  res.locals.authenticated = !!req.user;

  next();
});

app.use(app.router);

app.get('/login', function (req, res) {
  res.render('login');
});

app.get('/logout', function (req, res) {
  req.logout();

  res.redirect('/');
});

app.get('/auth/google', passport.authenticate('google', {
  accessType: 'offline',
  scope: [
    'https://www.googleapis.com/auth/glass.timeline',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ')
}));

app.get('/auth/google/callback', passport.authenticate('google'),
  function (req, res) {
  debug('authenticate callback', req.user);

  if (req.user) {
    // Get the user's profile information
    req.google().getFeed('https://www.googleapis.com/oauth2/v1/userinfo',
      function (err, body) {
      if (err) return;

      debug('userinfo body', body);

      users.setUser(req.user.id, {
        email: body.email,
        name: body.name,
        givenName: body.given_name,
        picture: body.picture
      }, function (err) {
        debug('err in setUser', err);
      });
    });

    // Send an initial timeline item
    req.google().post({
      uri: 'https://www.googleapis.com/glass/v1/timeline',
      json: timelineTemplate()
    }, function (err) {
      if (err) debug('initial timeline item err', err);
    });

    res.redirect('/data');
  } else {
    res.redirect('/login');
  }
});

// TODO: ensureLoggedIn
app.get('/data', function (req, res) {
  res.render('data', { userId: req.user.userId });
});

app.get('/data.css', function (req, res) {
  request.get({
    uri: 'https://moodglass.firebaseio.com/data/' + req.user.userId + '.json',
    json: true
  }, function (err, response, body) {
    var data = 'timestamp,mood,notes\n';

    Object.keys(body).forEach(function (key) {
      data += (body[key].timestamp || '') + ',';
      data += (body[key].mood || '') + ',';

      if (/,/.test(body[key].notes)) {
        body[key].notes = '"' + body[key].notes + '"';
      }

      data += (body[key].notes || '') + '\n';
    });

    res.set('Content-Type', 'text/plain');

    res.send(data);
  });
});

app.get('/data.json', function (req, res) {
  request.get({
    uri: 'https://moodglass.firebaseio.com/data/' + req.user.userId + '.json',
    json: true
  }, function (err, response, body) {
    var data = [];

    Object.keys(body).forEach(function (key) {
      data.push(body[key]);
    });

    res.json(data);
  });
});

// TODO: ensureLoggedIn
app.get('/trigger', function (req, res) {
  users.getLastMood(req.user.id || req.user.userId, function (err, lastMood) {
    debug(req.user.id, req.user.userId);
    debug('trigger err', err);
    debug('lastMood', lastMood);

    req.google().post({
      uri: 'https://www.googleapis.com/glass/v1/timeline',
      json: timelineTemplate(lastMood)
    }, function (err, body) {
      res.json(body);
    });
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
        userToken: req.user.id || req.user.userId // XXX
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

    users.setLastMood(req.body.userToken, mood, function (err) {
      if (err) debug('setLastMood err', err);
    });

    ref.push({ timestamp: Date.now(), mood: mood });
  } else {
    if (!req.body.userToken) {
      debug('Weird body', req.body);

      return;
    }

    users.getUser(req.body.userToken, function (err, user) {
      debug('body.userToken', req.body.userToken);
      debug('user', user);

      if (err || !user) return console.error('Error retrieving user!', err);

      google(user.accessToken, user.refreshToken)
        .getFeed('https://www.googleapis.com/glass/v1/timeline/' +
          req.body.itemId, function (err, body) {
        debug('err', err);
        debug('body', body);

        if (err) return;

        if (body.text) {
          // Retrieve the last record
          var onLastElement = ref.endAt().limit(1).on('child_added',
            function (snapshot) {
            var name = snapshot.name();
            var val = snapshot.val();

            debug('snapshot.name()', name);
            debug('snapshot.val()', val);

            if (Date.now() - THIRTY_MINUTES > val.timestamp) {
              // Create a new entry
              var guessedMood;

              if (/mostly good/i.test(body.text)) {
                guessedMood = 4;
              } else if (/mostly bad/i.test(body.text)) {
                guessedMood = 2;
              } else if (/good/i.test(body.text)) {
                guessedMood = 5;
              } else if (/bad/i.test(body.text)) {
                guessedMood = 1;
              } else if (/neutral/i.test(body.text)) {
                guessedMood = 3;
              }

              var data = {
                timestamp: Date.now(),
                notes: body.text
              };

              if (guessedMood) {
                data.mood = guessedMood;

                users.setLastMood(req.body.userToken, guessedMood,
                  function (err) {
                  if (err) debug('setLastMood err', err);
                });
              }

              ref.push(data);
            } else {
              // Update the entry
              val.notes = body.text;

              ref.child(name).update(val);
            }

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
