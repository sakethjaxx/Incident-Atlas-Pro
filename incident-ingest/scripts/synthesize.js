const fs = require('fs');
const data = JSON.parse(fs.readFileSync('fixtures/bench/incidents.json', 'utf8'));
const out = { ...data, incidents: [...data.incidents] };
let i = 0;
// We need ~3200 incidents to reach 10,000 chunks.
while(out.incidents.length < 3500) {
  for(const inc of data.incidents) {
    out.incidents.push({ ...inc, key: inc.key + '-' + i });
  }
  i++;
}
fs.writeFileSync('fixtures/bench/10k_incidents.json', JSON.stringify(out, null, 2));
