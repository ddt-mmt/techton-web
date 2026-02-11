import ldap from 'k6/x/ldap';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// --- CONFIGURATION ---
const target_ip = '__TARGET_IP__';
const use_csv = __USE_CSV__; 
const single_user_dn = '__USER_DN__';
const single_password = '__PASSWORD__';

export const options = {
  scenarios: {
    __SCENARIO_NAME__: __SCENARIO_BODY__
  },
  thresholds: __THRESHOLDS_BODY__
};

export default function () {
  if (__ITER == 0) sleep(Math.random() * 2); 

  let dn = single_user_dn;
  let pass = single_password;

  let client = null;
  
  try {
    // 1. Dial
    try {
        client = ldap.dialURL(`ldap://${target_ip}:389`);
    } catch (e) {
        sleep(1);
        return;
    }

    if (!client) throw new Error("Client null");

    // 2. Bind
    let bind_success = false;
    try {
        client.bind(dn, pass);
        bind_success = true;
    } catch(err) {
         // Expected for wrong password/stress
    }

    check(bind_success, {
      'bind success': (ok) => ok === true,
    });
    
    // 3. Search (Load Simulation)
    // Simple search to stress the DB
    try {
        client.search({
            baseDN: dn.split(',').slice(1).join(','),
            scope: ldap.ScopeSingleLevel,
            filter: "(objectClass=*)",
            attributes: ["dn"] // Minimal retrieval
        });
    } catch(err) {}

  } catch (e) {
    // Suppress
  } finally {
    if (client) {
        try { client.close(); } catch(e) {}
    }
  }
  
  sleep(Math.random() * 0.5 + 0.1); 
}
