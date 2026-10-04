import { startSetupFixture } from './setup-fixture';

const fixture = await startSetupFixture();
console.log(`工作区向导验收地址：${fixture.url}`);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void fixture.close();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
