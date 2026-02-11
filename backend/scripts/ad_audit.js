import ldap from 'k6/x/ldap';
import { check, sleep } from 'k6';

// --- CONFIGURATION ---
const target_ip = '__TARGET_IP__';

export const options = {
  scenarios: {
    audit: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
    },
  },
};

export default function () {
  let client = null;
  
  // 1. Test Anonymous Bind
  try {
    client = ldap.dialURL(`ldap://${target_ip}:389`);
    let anon_bind = false;
    try {
        client.bind("", "");
        anon_bind = true;
    } catch(e) {}

    check(anon_bind, {
      'Security Alert: Anonymous Bind Enabled': (v) => v === false,
    });
    
    if(client) client.close();
  } catch(e) {}

  // 2. Test RootDSE Exposure
  try {
     client = ldap.dialURL(`ldap://${target_ip}:389`);
     // performing search without bind
     try {
        client.search({
            baseDN: "",
            scope: ldap.ScopeBaseObject,
            filter: "(objectClass=*)",
            attributes: ["defaultNamingContext"] 
        });
        check(true, {
            'Info: RootDSE Exposed (Common)': (v) => v === true,
        });
     } catch(e) {}
     client.close();
  } catch(e) {}
}
