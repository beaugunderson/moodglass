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

function row(id, values) {
  return '<tr id="' + id + '">' +
    '<td>' + moment(values.timestamp).format('M/D/YY h:mma') + '</td>' +
    '<td>' + MOODS[values.mood] + '</td>' +
    '<td>' + (values.notes || '') + '</td>' +
  '</tr>';
}

ref.on('child_added', function (snapshot) {
  $('#rows').append(row(snapshot.name(), snapshot.val()));

  console.log('child_added', snapshot.name(), snapshot.val());
});

ref.on('value', function (snapshot) {
  snapshot.forEach(function (child) {
    $('#rows #' + child.name()).replaceWith(row(child.name(), child.val()));

    console.log('value', child.name(), child.val());
  });
});