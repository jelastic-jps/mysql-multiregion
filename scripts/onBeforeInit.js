var settings = jps.settings, markup = "",
    MAX_COUNT = "environment.maxcount",
    SAME_NODES = "environment.maxsamenodescount",
    MAX_NODES = "environment.maxnodescount";

var regions = jelastic.env.control.GetRegions(appid, session);
if (regions.result != 0) return regions;

var min = 2, name, value,
    nodesMarkup = "Cannot create the multiregional cluster. Please check this quotas: ", nodesMarkupHidden = true;

var hasCollaboration = (parseInt('${fn.compareEngine(7.0)}', 10) >= 0),
    quotas = [];

if (hasCollaboration) {
    quotas = [
        { quota : { name: MAX_COUNT }, value: parseInt('${quota.environment.maxcount}', 10) },
        { quota : { name: MAX_NODES }, value: parseInt('${quota.environment.maxnodescount}', 10) },
        { quota : { name: SAME_NODES }, value: parseInt('${quota.environment.maxsamenodescount}', 10) }
    ];
    group = { groupType: '${account.groupType}' };
} else {
    quotas.push(jelastic.billing.account.GetQuotas(MAX_COUNT).array[0]);
    quotas.push(jelastic.billing.account.GetQuotas(SAME_NODES).array[0]);
    quotas.push(jelastic.billing.account.GetQuotas(MAX_NODES).array[0]);
    group = jelastic.billing.account.GetAccount(appid, session);
}

for (var i = 0, n = quotas.length; i < n; i++) {
  name = quotas[i].quota.name;
  value = quotas[i].value;
  if (value < min) { nodesMarkup = nodesMarkup + " " + name; nodesMarkupHidden = false; };
}

settings.fields.push({"type":"displayfield","cls":"warning","height":30,"hideLabel":true,"markup":nodesMarkup,"hidden":nodesMarkupHidden});

if (regions.array.length < 1) {
  markup = "Package cannot be installed on less than 2 regions. Please contact support or choose a provider with more regions";
  settings.fields.push(
    {"type": "displayfield", "cls": "warning", "height": 30, "hideLabel": true, "markup": markup},
    {"type": "compositefield","height": 0,"hideLabel": true,"width": 0,"items": [{"height": 0,"type": "string","required": true}]}
  );
}

return {
    result: 0,
    settings: settings
};
