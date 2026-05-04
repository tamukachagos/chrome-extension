(async function () {
  const engine = window.PowerBIDaxEngine;
  if (!engine) {
    document.getElementById("output").textContent = "ERROR: PowerBIDaxEngine not found on window.";
    return;
  }

  // Load rules
  let rules = [];
  try {
    const res = await fetch("training/rules_advanced.json");
    rules = await res.json();
    engine.setRules(rules);
  } catch (e) {
    document.getElementById("output").textContent = "ERROR loading rules: " + e.message;
    return;
  }

  const daxInput = document.getElementById("daxInput");
  const output = document.getElementById("output");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");

  analyzeBtn.addEventListener("click", function () {
    const dax = daxInput.value.trim();
    if (!dax) {
      output.textContent = "Paste some DAX above and click Analyze.";
      return;
    }
    try {
      const results = engine.analyzeRuleMatches(dax);
      if (!results.length) {
        output.textContent = "No issues detected.";
        return;
      }
      output.textContent = JSON.stringify(
        results.map(function (r) {
          return {
            rule_id: r.rule ? r.rule.id : null,
            confidence: Number((r.confidence || 0).toFixed(3)),
            fix_type: r.fix_type,
            issue: r.issue,
            fix: r.fix
          };
        }),
        null,
        2
      );
    } catch (e) {
      output.textContent = "ERROR: " + e.message;
    }
  });

  clearBtn.addEventListener("click", function () {
    daxInput.value = "";
    output.textContent = "[]";
  });

  // Status
  const status = document.createElement("p");
  status.style.cssText = "font-size:0.75rem;color:#6b7280;margin:0.25rem 0 0;";
  status.textContent = "✅ Engine ready — " + rules.length + " rules loaded.";
  document.querySelector(".actions").after(status);
})();
