function DBRecovery() {
    const AUTH_ERROR_CODE = 701,
        MYISAM_ERROR = 97,
        UNABLE_RESTORE_CODE = 98,
        FAILED_CLUSTER_CODE = 99,
        RESTORE_SUCCESS = 201,
        XTRADB = "xtradb",
        GALERA = "galera",
        SECONDARY = "secondary",
        PRIMARY = "primary",
        MASTER = "master",
        SLAVE = "slave",
        FAILED_UPPER_CASE = "FAILED",
        FAILED = "failed",
        SUCCESS = "success",
        WARNING = "warning",
        ROOT = "root",
        DOWN = "down",
        UP = "up",
        OK = "ok",
        SQLDB = "sqldb";

    var me = this,
        isRestore = false,
        envName = "${env.name}",
        config = {},
        envs = [],
        nodeManager;

    nodeManager = new nodeManager();
    
    me.process = function() {
   
        let resp = me.defineEnvs(envName);
        if (resp.result != 0) return resp;
        
        resp = me.defineScheme();
        if (resp.result != 0) return resp;
        
        resp = me.defineRestore();
        if (resp.result != 0) return resp;
        
        resp = me.execDiagnostic();
        if (resp.result != 0) return resp;
        
        resp = me.parseResponse(resp.responses);
        if (resp.result == UNABLE_RESTORE_CODE || resp.result == MYISAM_ERROR) return resp;
        
        if (isRestore) {
            let failedPrimaries = me.getFailedPrimaries();
            let failedPrimariesByStatus = me.getFailedPrimariesByStatus();
            
            if (failedPrimaries.length || failedPrimariesByStatus.length) {
                if (!me.getDonorIp()) {
                    return {
                        result: UNABLE_RESTORE_CODE,
                        type: WARNING
                    };
                }

                if (failedPrimaries.length) {
                    resp = me.recoveryNodes(failedPrimaries);
                    if (resp.result != 0) return resp;
                    me.setPrimaryStatusFailed(false);
                }

                if (failedPrimariesByStatus.length) {
                    resp = me.recoveryNodes(me.getFailedPrimariesByStatus());
                    if (resp.result != 0) return resp;
                }

                resp = me.getSecondariesOnly();
                if (resp.result != 0) return resp;

                me.setFailedNodes(resp.nodes, true);
                me.primaryRestored(true);
            }
            
            resp = me.recoveryNodes();
            if (resp.result != 0) return resp;
            
        } else {
            if (me.getEvent() && me.getAction()) {
                return {
                    result: 0,
                    errors: resp.result == FAILED_CLUSTER_CODE ? true : false
                };
            }
        }
        if (resp.result != 0) return resp;    

        return {
            result: !isRestore ? 200 : RESTORE_SUCCESS,
            type: SUCCESS
        };
        
    };
    
    me.defineEnvs = function(envName) {
        
        function getList(envName, items) {
            var result = [],
                index = 0,
                itemData,
                targetEnvNamePrefix;
            
            function dataExtractor(envName) {
                var envNameSeparator = "-db-",
                    index,
                    tmp;
                
                tmp = envName.split(envNameSeparator);
                index = tmp.pop();
                
                if (/\d+/.test(index)) {
                    index = parseInt(index, 10);
                } else {
                    index = null;
                }        
                
                return {
                    envName: envName,
                    envNamePrefix: tmp.join(envNameSeparator),
                    index: index
                };
                
            }
            
            function filter(data) {
                return data.envNamePrefix === targetEnvNamePrefix &&
                    typeof data.index === "number" && !isNaN(data.index);
            }
            
            targetEnvNamePrefix = dataExtractor(envName).envNamePrefix;
            
            for(var i=0, item; item = items[i]; i++) {
                itemData = dataExtractor(item.env.envName);
                
                if (filter(itemData)) {
                    result.push(itemData.envName);
                    index = Math.max(index, itemData.index);
                }        
            }
            
            return {
                items       : result,
                nextIndex   : index + 1
            };
        }
        
        var resp = jelastic.environment.control.GetEnvs(appid, session);
        if (resp.result != 0) return resp;
        
        var data = getList(envName, resp.infos);
        
        (data.items.length) ? me.setEnvNames(data.items) : me.setEnvNames(envName);
        
        return { result: 0 };    
    }

    me.execDiagnostic = function() {
        let envNames,
            nodes,
            resp,
            responses = [];

        envNames = me.getEnvNames();
        
        for (let i = 0, n = envNames.length; i < n; i++) {
            envName = envNames[i];
            
            resp = nodeManager.getSQLNodes({
                envName: envNames[i]           
            });
            if (resp.result != 0) return resp;
            
            nodeIDs = resp.nodesIDs;
            
            for (let k = 0, l = nodeIDs.length; k < l; k++) {
            
                resp = me.execRecovery({
                    envName: envName,
                    nodeid: nodeIDs[k],
                    diagnostic: true
                });
                if (resp.result != 0) return resp;
            
                if (resp.responses[0]) resp.responses[0].envName = envName;
                
                responses.push(resp.responses);
            }
        }
        
        return {
            result: 0,
            responses: responses
        };
    };
    
    me.defineRestore = function() {
        let exec = getParam('exec', '');
        let init = getParam('init', '');
        let event = getParam('event', '');

        if (!exec) isRestore = true;
        exec = exec || " --diagnostic";
        
        log("exec->" + exec);
        
        if (init) {
            me.setInitialize(true);
            
            let resp = me.execRecovery();
            if (resp.result != 0) return resp;
            
            me.setInitialize(false);

            resp = me.parseResponse(resp.responses);
            if (resp.result != 0) return resp;
        }

        me.setAction(exec);
        me.setEvent(event);
        me.setScenario();

        return { result: 0 };
    };

    me.defineScheme = function() {
        
        let resp = api.env.control.GetContainerEnvVarsByGroup(envName, session, SQLDB);
        if (resp.result != 0) return resp;
        
        if (resp.object && resp.object.SCHEME) {   
            scheme = resp.object.SCHEME;
            if (/slave/.test(scheme) || /secondary/.test(scheme)) scheme = SECONDARY;
            if (/master/.test(scheme) || /primary/.test(scheme)) scheme = PRIMARY;
            if (/galera/.test(scheme) || /xtradb/.test(scheme)) scheme = GALERA;
            me.setScheme(scheme);
        }
        
        return { result: 0 }
    };
    
    me.getEnvNames = function() {
        return config.envNames;
    };

    me.setEnvNames = function(envNames) {
        config.envNames = envNames;
    };

    me.getScheme = function() {
        return config.scheme;
    };

    me.setScheme = function(scheme) {
        config.scheme = scheme;
    };

    me.setScenario = function() {
        config.scenarios = {};
        config.scenarios[GALERA] = "galera";
        config.scenarios[PRIMARY] = "secondary_from_primary";
        config.scenarios[PRIMARY + "_" + PRIMARY] = "primary_from_primary";
        config.scenarios[PRIMARY + "_" + SECONDARY] = "primary_from_secondary";
        config.scenarios[SECONDARY] = "secondary_from_primary";
    };

    me.getScenario = function(scenario) {
        return config.scenarios[scenario];
    };

    me.getInitialize = function() {
        return config.initialize || false;
    };

    me.setInitialize = function(init) {
        config.initialize = init;
    };

    me.getEvent = function() {
        return config.event || false;
    };

    me.setEvent = function(event) {
        config.event = event;
    };

    me.getAction = function() {
        return config.action;
    };

    me.setAction = function(action) {
        config.action = action;
    };

    me.getFailedNodes = function() {
        return config.failedNodes || [];
    };

    me.setFailedNodes = function(node, updateValue) {
        if (updateValue) {
            config.failedNodes = node;
        } else {
            config.failedNodes = config.failedNodes || [];
            node ? config.failedNodes.push(node) : config.failedNodes = [];
        }
    };

    me.getFailedPrimaries = function() {
        return config.failedPrimaries || [];
    };

    me.setFailedPrimaries = function(node) {
        config.failedPrimaries = config.failedPrimaries || [];
        node ? config.failedPrimaries.push(node) : config.failedPrimaries = [];
    };

    me.setFailedPrimariesByStatus = function(node) {
        config.failedPrimariesByStatus = config.failedPrimariesByStatus || [];
        node ? config.failedPrimariesByStatus.push(node) : config.failedPrimariesByStatus = [];
    };

    me.getFailedPrimariesByStatus = function() {
        return config.failedPrimariesByStatus || [];
    };

    me.primaryRestored = function(restored) {
        if (restored) {
            config.primaryRestored = restored;
        }
        return config.primaryRestored || false;
    };

    me.setPrimaryDonor = function(primary) {
        config.primaryDonor = primary;
    };

    me.getPrimaryDonor = function() {
        return config.primaryDonor || "";
    };

    me.getAdditionalPrimary = function() {
        return config.additionalPrimary || "";
    };

    me.setAdditionalPrimary = function(primary) {
        config.additionalPrimary = primary;
    };

    me.getDonorIp = function() {
        return config.donorIp || "";
    };

    me.setDonorIp = function(donor) {
        config.donorIp = donor;
    };

    me.getPrimaryStatusFailed = function() {
        return config.primaryStatuses || 0;
    };

    me.setPrimaryStatusFailed = function(value) {
        config.primaryStatuses = config.primaryStatuses || 0;
        config.primaryStatuses += value ? 1 : 0;
    };

    me.parseResponse = function parseResponse(response) {
        let item, resp, out, currentEnvName;
        
        me.setFailedPrimariesByStatus();
        me.setFailedPrimaries();
        me.setFailedNodes();

        for (let i = 0, n = response.length; i < n; i++) {
                       
            if (response[i]) {
                currentEnvName = JSON.parse(response[i]).envName;
                item = JSON.parse(response[i]).out;
                item = JSON.parse(item);
                
                log("item->" + item);

                if (item.result == AUTH_ERROR_CODE) {
                    return {
                        type: WARNING,
                        message: item.error,
                        result: AUTH_ERROR_CODE
                    };
                }
                
                if (!item.node_type) {
                    if (!isRestore) {
                        let resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName);
                        if (resp.result != 0) return resp;
                        continue;
                    }
                }

                if (item.result == 0) {
                    switch (String(me.getScheme())) {
                        case GALERA:
                            resp = me.checkGalera(item, currentEnvName);
                            if (resp.result != 0) return resp;
                            break;

                        case PRIMARY:
                            
                            
                            
                            resp = me.checkPrimary(item, currentEnvName);
                            if (resp.result != 0) return resp;
                            break;

                        case SECONDARY:
                            resp = me.checkSecondary(item, currentEnvName);
                            if (resp.result != 0) return resp;
                            break;
                    }
                } else {
                    return {
                        result: isRestore ? UNABLE_RESTORE_CODE : FAILED_CLUSTER_CODE,
                        type: WARNING
                    };
                }
            }
        }

        if (me.getPrimaryStatusFailed() == me.getEnvNames().length && isRestore) {
            return {
                result: UNABLE_RESTORE_CODE,
                type: WARNING
            }
        }

        return { result: 0 }
    };

    me.checkGalera = function checkGalera(item, currentEnvName) {
        
        if (item.service_status == DOWN || item.status == FAILED) {
            if (!me.getDonorIp()) {
                me.setDonorIp(GALERA);
            }

            me.setFailedNodes({
                address: item.address,
                scenario: me.getScenario(GALERA)
            });

            if (!isRestore) {
                let resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName);
                if (resp.result != 0) return resp;
            }
        }

        if (!isRestore && me.getFailedNodes().length) {
            return {
                result: FAILED_CLUSTER_CODE,
                type: WARNING
            };
        }

        if (item.service_status == UP && item.status == OK) {
            let resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName, true);
            if (resp.result != 0) return resp;
        }

        return {
            result: 0
        }
    };

    me.checkPrimary = function(item, currentEnvName) {
        let resp, setFailedLabel = false;

        if (item.service_status == DOWN || item.status == FAILED) {
            if (item.service_status == UP) {
                if (!me.getDonorIp() && item.node_type == PRIMARY) {
                    me.setDonorIp(item.address);
                    me.setPrimaryDonor(item.address);
                }
            }
            
            if (!isRestore && item.status == FAILED && item.service_status == DOWN) {
                resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName);
                if (resp.result != 0) return resp;
                setFailedLabel = true;

                return {
                    result: FAILED_CLUSTER_CODE,
                    type: SUCCESS
                };
            }
            
            if (item.status == FAILED) {
                if (!setFailedLabel) {
                    resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName);
                    if (resp.result != 0) return resp;
                }

                if (item.node_type == PRIMARY) {
                    if (item.service_status == DOWN) {
                        me.setFailedPrimaries({
                            address: item.address,
                            envName: currentEnvName
                        });
                    } else {
                        me.setFailedPrimariesByStatus({
                            address: item.address,
                            envName: currentEnvName
                        });
                    }
                    me.setPrimaryStatusFailed(true);
                } else {
                    me.setFailedNodes({
                        address: item.address,
                        envName: currentEnvName
                    });
                    
                    log("setFailedNodes->>" + me.getFailedNodes());
                }

                if (!isRestore) {
                    return {
                        result: FAILED_CLUSTER_CODE,
                        type: WARNING
                    };
                }
            }
        }
        
        if (item.service_status == UP && item.status == OK) {
            if (item.node_type == PRIMARY) {
                if (me.getDonorIp()) {
                    me.setAdditionalPrimary(item.address);
                } else {
                  me.setDonorIp(item.address);  
                  me.setPrimaryDonor(item.address);
                }
            }

            resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName, true);
            if (resp.result != 0) return resp;
            me.setPrimaryStatusFailed(false);
        }        
        return {
            result: 0
        }
    };

    me.checkSecondary = function(item, currentEnvName) {
        let resp;

        if (item.service_status == DOWN || item.status == FAILED) {
            
            if (!isRestore) {
                
                resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName);
                
                if (resp.result != 0) return resp;
                return {
                    result: FAILED_CLUSTER_CODE,
                    type: SUCCESS
                };
            }

            if (item.node_type == PRIMARY) {
                
                me.setFailedPrimaries({
                    address: item.address,
                    envName: currentEnvName,
                    scenario: me.getScenario(PRIMARY + "_" + SECONDARY)
                });
            } else {
                
                me.setFailedNodes({
                    address: item.address,
                    envName: currentEnvName,
                    scenario: me.getScenario(SECONDARY)
                });
            }
        }

        if (item.service_status == UP && item.status == OK) {
            if (item.node_type == PRIMARY) {
                me.setPrimaryDonor(item.address);
            }

            me.setDonorIp(item.address);
            resp = nodeManager.setFailedDisplayNode(item.address, currentEnvName, true);
            if (resp.result != 0) return resp;
        } else if (item.node_type == SECONDARY && item.service_status == UP) {
            me.setDonorIp(item.address);
        }

        if (me.getPrimaryDonor()) {
            me.setDonorIp(me.getPrimaryDonor());
        }

        return {
            result: 0
        }
    };

    me.recoveryNodes = function recoveryNodes(nodes) {
        let failedNodes = nodes || me.getFailedNodes();
        let resp;

        if (failedNodes.length) {
            for (let i = 0, n = failedNodes.length; i < n; i++) {
                
                resp = nodeManager.getNodeIdByIp({
                    address: failedNodes[i].address,
                    envName: failedNodes[i].envName
                });
                
                if (resp.result != 0) return resp;

                resp = me.execRecovery({
                    nodeid: resp.nodeid,
                    envName: failedNodes[i].envName
                });
                if (resp.result != 0) return resp;

                resp = me.parseResponse(resp.responses);
                if (resp.result == UNABLE_RESTORE_CODE || resp.result == FAILED_CLUSTER_CODE) return resp;
            }

            let resp = me.execDiagnostic({ diagnostic: true });
            if (resp.result != 0) return resp;

            resp = me.parseResponse(resp.responses);
            if (resp.result != 0) return resp;
        }

        return  { result: 0 }
    };

    me.execRecovery = function(values) {
        values = values || {};
        log("values->" + values);
        log("curl --silent https://raw.githubusercontent.com/sych74/mysql-cluster/JE-71286/addons/recovery/scripts/db-recovery.sh > /tmp/db-recovery.sh && bash /tmp/db-recovery.sh " + me.formatRecoveryAction(values));
        return nodeManager.cmd({
            command: "curl --silent https://raw.githubusercontent.com/sych74/mysql-cluster/JE-71286/addons/recovery/scripts/db-recovery.sh > /tmp/db-recovery.sh && bash /tmp/db-recovery.sh " + me.formatRecoveryAction(values),
            nodeid: values.nodeid || "",
            envName: values.envName
        });
    };

    me.formatRecoveryAction = function(values) {
        let scenario = me.getScenario(me.getScheme());
        let donor = me.getDonorIp();
        let action = "";

        if (me.getInitialize()) {
            return action = "init";
        }

        if (values.diagnostic) {
            return " --diagnostic";
        }

        if (!me.primaryRestored() && (me.getFailedPrimaries().length || me.getFailedPrimariesByStatus().length)) {
            scenario = me.getScenario(PRIMARY + "_" + ((me.getScheme() == SECONDARY) ? SECONDARY : PRIMARY));
        } else {
            if (me.getAdditionalPrimary()) {
                donor = me.getPrimaryDonor() + " --additional-primary " + me.getAdditionalPrimary();
            }
        }

        if (scenario && donor) {
            action = "--scenario restore_" + scenario + " --donor-ip " + donor;
        } else {
            action = me.getAction();
        }

        return action;
    };

    me.getSecondariesOnly = function() {
        let secondaries = [];

        let resp = nodeManager.getSQLNodes();
        if (resp.result != 0) return resp;

        for (let i = 0, n = resp.nodes.length; i < n; i++) {
            if (resp.nodes[i].address != me.getPrimaryDonor() && resp.nodes[i].address != me.getAdditionalPrimary()) {
                secondaries.push({
                    address: resp.nodes[i].address
                });
            }
        }

        return {
            result: 0,
            nodes: secondaries
        }
    };


    function nodeManager() {
        var me = this;

        me.getEnvInfo = function(values) {
            values = values || {};
            return api.env.control.GetEnvInfo(values.envName || envName, session);
        };

        me.getNodeGroups = function() {
            var envInfo;

            envInfo = this.getEnvInfo();
            if (envInfo.result != 0) return envInfo;

            return {
                result: 0,
                nodeGroups: envInfo.nodeGroups
            }
        };
        
        me.getSQLNodes = function(values) {
            var envInfo,
                sqlNodes = [],
                nodesIDs = [],
                nodes;
            
            values = values || {};

            envInfo = me.getEnvInfo({
                envName : values.envName || envName
            });
            
            if (envInfo.result != 0) return envInfo;
            nodes = envInfo.nodes;

            for (var i = 0, n = nodes.length; i < n; i++) {
                if (nodes[i].nodeGroup == SQLDB) {
                    sqlNodes.push(nodes[i]);
                    nodesIDs.push(nodes[i].id);
                }
            }

            return {
                result: 0,
                nodes: sqlNodes,
                nodesIDs: nodesIDs
            }
        };

        me.getNodeIdByIp = function(values) {
            var envInfo,
                nodes,
                id = "";

            values = values || {};
            
            envInfo = me.getEnvInfo({
                envName : values.envName || envName
            });
            if (envInfo.result != 0) return envInfo;

            nodes = envInfo.nodes;
            
            for (var i = 0, n = nodes.length; i < n; i++) {
                if (nodes[i].address == values.address) {
                    id = nodes[i].id;
                    break;
                }
            }
            
            return {
                result: 0,
                nodeid : id
            }
        };

        me.getNodeInfoById = function(values) {
            var envInfo,
                nodes,
                node;

            values = values || {};

            envInfo = me.getEnvInfo({
                envName: values.envName || "",
                reset: true
            });
            if (envInfo.result != 0) return envInfo;

            nodes = envInfo.nodes;

            for (var i = 0, n = nodes.length; i < n; i++) {
                if (nodes[i].id == values.id) {
                    node = nodes[i];
                    break;
                }
            }

            return {
                result: 0,
                node: node
            }
        };

        me.setFailedDisplayNode = function(address, currentEnvName, removeLabelFailed) {
            var REGEXP = new RegExp('\\b - ' + FAILED + '\\b', 'gi'),
                displayName,
                resp,
                node;

            removeLabelFailed = !!removeLabelFailed;

            resp = me.getNodeIdByIp({
                envName: currentEnvName,
                address: address,
                reset: true
            });

            if (resp.result == 0 && !resp.nodeid) {

                resp = me.getNodeIdByIp({
                    envName: currentEnvName,
                    address: address,
                    reset: true
                });
            }

            if (resp.result != 0 || !resp.nodeid) return resp;

            resp = me.getNodeInfoById({
                envName: currentEnvName,
                id: resp.nodeid
            });
            if (resp.result != 0) return resp;
            
            node = resp.node;
            node.displayName = node.displayName || ("Node ID: " + node.id);

            if (removeLabelFailed) {
                displayName =  node.displayName.replace(REGEXP, "");
            } else {
                displayName = node.displayName.indexOf(FAILED_UPPER_CASE) == -1 ? (node.displayName + " - " + FAILED_UPPER_CASE) : node.displayName;
            }

            return api.env.control.SetNodeDisplayName(currentEnvName, session, node.id, displayName);
        };

        me.cmd = function(values) {
            let resp;

            values = values || {};

            if (values.nodeid) {
                resp = api.env.control.ExecCmdById(values.envName || envName, session, values.nodeid, toJSON([{ command: values.command }]), true, ROOT);
            } else {
                resp = api.env.control.ExecCmdByGroup(values.envName || envName, session, values.nodeGroup || SQLDB, toJSON([{ command: values.command }]), true, false, ROOT);
            }

            return resp;
        }
    };
    function log(message) {
        if (api.marketplace && jelastic.marketplace.console && message) {
            return api.marketplace.console.WriteLog(appid, session, message);
        }

        return { result : 0 };
    }
};

return new DBRecovery().process();
