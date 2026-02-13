import ldap from 'k6/x/ldap';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';
import { vu } from 'k6';

// --- CONFIGURATION ---
const target_ip = '__TARGET_IP__';
const use_csv = __USE_CSV__; 
const single_user_dn = '__USER_DN__';
const single_password = '__PASSWORD__';
const override_base_dn = '__BASE_DN__';

let users = null;
if (use_csv) {
    users = new SharedArray('users_from_csv', function () {
        // Load CSV file from the root of the test run directory (where k6 is executed)
        const csvData = open('./users.csv'); 
        const parsedData = csvData.split(/\r\n|\n/).map(s => s.trim()).filter(s => s.length > 0).map(line => {
            const parts = line.split(',');
            return {
                username: parts[0].trim(),
                password: parts[1].trim()
            };
        });
        return parsedData;
    });
}

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

  if (use_csv && users && users.length > 0) {
      const userIndex = vu.idInTest % users.length;
      dn = users[userIndex].username;
      pass = users[userIndex].password;
  }


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
        if (__ITER === 0) {
            console.error(`Bind Failed for user ${dn}: ${err}`);
        }
    }

    check(bind_success, {
      'bind success': (ok) => ok === true,
    });
    
    if (!bind_success) {
        if (client) try { client.close(); } catch(e) {}
        sleep(2); 
        return;
    }
    
    // 3. Search (Aggressive Load Simulation)
    // We perform multiple searches per connection to stress the CPU
    let searchBase = override_base_dn;
    
    if (!searchBase) {
        if (dn.includes("DC=")) {
            // If user provided a full DN, use its parent as base
            searchBase = dn.split(',').slice(1).join(',');
        } else {
            // Auto-Discovery via RootDSE
            try {
                 const rootDSE = client.search({
                    baseDN: "",
                    scope: ldap.ScopeBaseObject,
                    filter: "(objectClass=*)",
                    attributes: ["defaultNamingContext"]
                 });
                 
                 if (rootDSE && rootDSE.length > 0) {
                     // Extract defaultNamingContext
                     for (let entry of rootDSE) {
                        for (let attr of entry.attributes) {
                            if (attr.name === "defaultNamingContext" && attr.values.length > 0) {
                                searchBase = attr.values[0];
                                break;
                            }
                        }
                     }
                 }
            } catch(e) {
                if (__ITER === 0) console.error("Auto-Discovery Failed: " + e);
            }
            
            // Final Fallback
            if (!searchBase) searchBase = "DC=net,DC=brin,DC=go,DC=id";
        }
    }

    // Log the BaseDN being used (once per VU)
    if (__ITER === 0) {
        console.log(`Using Search Base: ${searchBase}`);
    }

    try {
        for (let i = 0; i < 20; i++) {
            client.search({
                baseDN: searchBase,
                scope: ldap.ScopeWholeSubtree, // Recursive search is much heavier
                filter: "(objectClass=*)",
                attributes: ["dn", "cn", "sAMAccountName"] 
            });
        }
    } catch(err) {}

  } catch (e) {
    // Suppress
  } finally {
    if (client) {
        try { client.close(); } catch(e) {}
    }
  }
  
  // Minimal sleep to allow connection cycling but keep load high
  sleep(0.1); 
}
