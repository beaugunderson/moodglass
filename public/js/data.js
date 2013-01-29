/*global $:true moment:true Firebase:true userId:true*/

if (!userId || userId === '') {
  return;
}

var ref = new Firebase('https://moodglass.firebaseio.com/data/' + userId);

var MOODS = {
  1: 'Bad',
  2: 'Mostly bad',
  3: 'Neutral',
  4: 'Mostly good',
  5: 'Good'
};

var IMAGES = {
  1: 'red-full.png',
  2: 'red-half.png',
  3: 'yellow-full.png',
  4: 'green-half.png',
  5: 'green-full.png'
};

function row(id, values) {
  return '<tr id="' + id + '">' +
    '<td>' + moment(values.timestamp).format('M/D/YY h:mma') + '</td>' +
    '<td>' +
      (IMAGES[values.mood] ?
        '<img src="/img/' + IMAGES[values.mood] + '"> ' :
        '') + ' ' +
      (MOODS[values.mood] || '') +
    '</td>' +
    '<td>' + (values.notes || '') + '</td>' +
  '</tr>';
}

var rows = [];

// TODO: defer
function updateTotals() {
  var totals = {};
  var total = 0;

  rows.forEach(function (row) {
    if (!row.mood) {
      return;
    }

    if (!totals[row.mood]) {
      totals[row.mood] = 0;
    }

    totals[row.mood] += 1;

    total++;
  });

  Object.keys(totals).forEach(function (mood) {
    $('#mood-' + mood).text(Math.round((totals[mood] / total) * 100));
  });
}

function updateTimes() {
  var ourRows = rows.slice();

  ourRows = ourRows.sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });

  var first = ourRows.slice(0, 1)[0];
  var last = ourRows.slice(-1)[0];

  var timespans = [];
  var timespan = Math.abs(last.timestamp - first.timestamp);

  var lastRow;

  ourRows.forEach(function (row) {
    if (lastRow) {
      var difference = lastRow.timestamp - row.timestamp;

      timespans.push({
        mood: row.mood,
        span: (difference / timespan) * 100
      });
    }

    lastRow = row;
  });

  var TYPES = {
    1: 'success',
    3: 'warning',
    5: 'danger'
  };

  $('#timeline').html('');

  timespans.forEach(function (timespan) {
    $('#timeline').append('<div class="bar bar-' + TYPES[timespan.mood] +
      '" style="width: ' + timespan.span + '%"></div>');
  });
}

ref.on('child_added', function (snapshot) {
  $('#rows').prepend(row(snapshot.name(), snapshot.val()));

  rows.push(snapshot.val());

  updateTotals();
  updateTimes();
});

ref.on('value', function (snapshot) {
  snapshot.forEach(function (child) {
    $('#rows #' + child.name()).replaceWith(row(child.name(), child.val()));
  });

  updateTotals();
});
