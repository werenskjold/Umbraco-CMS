/**
 * @ngdoc service
 * @name umbraco.services.navigationService
 *
 * @requires $rootScope
 * @requires $routeParams
 * @requires $log
 * @requires $location
 * @requires dialogService
 * @requires treeService
 * @requires sectionResource
 *
 * @description
 * Service to handle the main application navigation. Responsible for invoking the tree
 * Section navigation and search, and maintain their state for the entire application lifetime
 *
 */
function navigationService($rootScope, $route, $routeParams, $log, $location, $q, $timeout, $injector, urlHelper, eventsService, dialogService, umbModelMapper, treeService, notificationsService, historyService, appState, angularHelper) {

    //the promise that will be resolved when the navigation is ready
    var navReadyPromise = $q.defer();

    //the main tree's API reference, this is acquired when the tree has initialized
    var mainTreeApi = null;

    eventsService.on("app.navigationReady", function (e, args) {
        mainTreeApi = args.treeApi;
        navReadyPromise.resolve(mainTreeApi);
    });

    //A list of query strings defined that when changed will not cause a reload of the route
    var nonRoutingQueryStrings = ["mculture", "cculture"];

    //used to track the current dialog object
    var currentDialog = null;
        
    //tracks the user profile dialog
    var userDialog = null;

    function setMode(mode) {
        switch (mode) {
        case 'tree':
            appState.setGlobalState("navMode", "tree");
            appState.setGlobalState("showNavigation", true);
            appState.setMenuState("showMenu", false);
            appState.setMenuState("showMenuDialog", false);
            appState.setGlobalState("stickyNavigation", false);
            appState.setGlobalState("showTray", false);

            //$("#search-form input").focus();
            break;
        case 'menu':
            appState.setGlobalState("navMode", "menu");
            appState.setGlobalState("showNavigation", true);
            appState.setMenuState("showMenu", true);
            appState.setMenuState("showMenuDialog", false);
            appState.setGlobalState("stickyNavigation", true);
            break;
        case 'dialog':
            appState.setGlobalState("navMode", "dialog");
            appState.setGlobalState("stickyNavigation", true);
            appState.setGlobalState("showNavigation", true);
            appState.setMenuState("showMenu", false);
            appState.setMenuState("showMenuDialog", true);
            break;
        case 'search':
            appState.setGlobalState("navMode", "search");
            appState.setGlobalState("stickyNavigation", false);
            appState.setGlobalState("showNavigation", true);
            appState.setMenuState("showMenu", false);
            appState.setSectionState("showSearchResults", true);
            appState.setMenuState("showMenuDialog", false);

            //TODO: This would be much better off in the search field controller listening to appState changes
            $timeout(function() {
                $("#search-field").focus();
            });

            break;
        default:
            appState.setGlobalState("navMode", "default");
            appState.setMenuState("showMenu", false);
            appState.setMenuState("showMenuDialog", false);
            appState.setSectionState("showSearchResults", false);
            appState.setGlobalState("stickyNavigation", false);
            appState.setGlobalState("showTray", false);

            if (appState.getGlobalState("isTablet") === true) {
                appState.setGlobalState("showNavigation", false);
            }

            break;
        }
    }

    /**
     * Converts a string request path to a dictionary of route params
     * @param {any} requestPath
     */
    function pathToRouteParts(requestPath) {
        if (!angular.isString(requestPath)) {
            throw "The value for requestPath is not a string";
        }
        var pathAndQuery = requestPath.split("#")[1];
        if (pathAndQuery) {
            if (pathAndQuery.indexOf("%253") || pathAndQuery.indexOf("%252")) {
                pathAndQuery = decodeURIComponent(pathAndQuery);
            }
            var pathParts = pathAndQuery.split("?");
            var path = pathParts[0];
            var qry = pathParts.length === 1 ? "" : pathParts[1];
            var qryParts = qry.split("&");
            var result = {
                path: path
            };
            for (var i = 0; i < qryParts.length; i++) {
                var keyVal = qryParts[i].split("=");
                if (keyVal.length == 2) {
                    result[keyVal[0]] = keyVal[1];
                }
            }
            return result;
        }
    }

    var service = {

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#isRouteChangingNavigation
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Detects if the route param differences will cause a navigation change or if the route param differences are
         * only tracking state changes.
         * This is used for routing operations where reloadOnSearch is false and when detecting form dirty changes when navigating to a different page.
         * @param {object} currUrlParams Either a string path or a dictionary of route parameters
         * @param {object} nextUrlParams Either a string path or a dictionary of route parameters
         */
        isRouteChangingNavigation: function (currUrlParams, nextUrlParams) {

            if (angular.isString(currUrlParams)) {
                currUrlParams = pathToRouteParts(currUrlParams);
            }

            if (angular.isString(nextUrlParams)) {
                nextUrlParams = pathToRouteParts(nextUrlParams);
            }

            var allowRoute = true;

            //The only time that we want to not route is if only any of the nonRoutingQueryStrings have changed/added.
            //If any of the other parts have changed we do not cancel
            var currRoutingKeys = _.difference(_.keys(currUrlParams), nonRoutingQueryStrings);
            var nextRoutingKeys = _.difference(_.keys(nextUrlParams), nonRoutingQueryStrings);
            var diff = _.difference(currRoutingKeys, nextRoutingKeys);
            //if the routing parameter keys are the same, we'll compare their values to see if any have changed and if so then the routing will be allowed.
            if (diff.length == 0) {
                var partsChanged = 0;
                _.each(currRoutingKeys, function (k) {
                    if (currUrlParams[k] != nextUrlParams[k]) {
                        partsChanged++;
                    }
                });
                if (partsChanged === 0) {
                    allowRoute = false; //nothing except our query strings changed, so don't continue routing
                }
            }

            return allowRoute;
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#waitForNavReady
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * returns a promise that will resolve when the navigation is ready
         */
        waitForNavReady: function () {
            return navReadyPromise.promise;
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#clearSearch
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * utility to clear the querystring/search params while maintaining a known list of parameters that should be maintained throughout the app
         */
        clearSearch: function () {
            var toRetain = ["mculture"];
            var currentSearch = $location.search();
            $location.search('');
            _.each(toRetain, function (k) {
                if (currentSearch[k]) {
                    $location.search(k, currentSearch[k]);
                }
            });
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#load
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Shows the legacy iframe and loads in the content based on the source url
         * @param {String} source The URL to load into the iframe
         */
        loadLegacyIFrame: function (source) {
            $location.path("/" + appState.getSectionState("currentSection") + "/framed/" + encodeURIComponent(source));
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#changeSection
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Changes the active section to a given section alias
         * If the navigation is 'sticky' this will load the associated tree
         * and load the dashboard related to the section
         * @param {string} sectionAlias The alias of the section
         */
        changeSection: function(sectionAlias, force) {
            setMode("default-opensection");

            if (force && appState.getSectionState("currentSection") === sectionAlias) {
                appState.setSectionState("currentSection", "");
            }

            appState.setSectionState("currentSection", sectionAlias);
            this.showTree(sectionAlias);

            $location.path(sectionAlias);
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#showTree
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Displays the tree for a given section alias but turning on the containing dom element
         * only changes if the section is different from the current one
		 * @param {string} sectionAlias The alias of the section to load
         * @param {Object} syncArgs Optional object of arguments for syncing the tree for the section being shown
		 */
        showTree: function (sectionAlias, syncArgs) {
            if (sectionAlias !== appState.getSectionState("currentSection")) {
                appState.setSectionState("currentSection", sectionAlias);

                if (syncArgs) {
                    return this.syncTree(syncArgs);
                }
            }
            setMode("tree");

            return $q.when(true);
        },

        showTray: function () {
            appState.setGlobalState("showTray", true);
        },

        hideTray: function () {
            appState.setGlobalState("showTray", false);
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#syncTree
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Syncs a tree with a given path, returns a promise
         * The path format is: ["itemId","itemId"], and so on
         * so to sync to a specific document type node do:
         * <pre>
         * navigationService.syncTree({tree: 'content', path: ["-1","123d"], forceReload: true});
         * </pre>
         * @param {Object} args arguments passed to the function
         * @param {String} args.tree the tree alias to sync to
         * @param {Array} args.path the path to sync the tree to
         * @param {Boolean} args.forceReload optional, specifies whether to force reload the node data from the server even if it already exists in the tree currently
         * @param {Boolean} args.activate optional, specifies whether to set the synced node to be the active node, this will default to true if not specified
         */
        syncTree: function (args) {
            if (!args) {
                throw "args cannot be null";
            }
            if (!args.path) {
                throw "args.path cannot be null";
            }
            if (!args.tree) {
                throw "args.tree cannot be null";
            }

            return navReadyPromise.promise.then(function () {
                return mainTreeApi.syncTree(args);
            });
        },

        /**
            Internal method that should ONLY be used by the legacy API wrapper, the legacy API used to
            have to set an active tree and then sync, the new API does this in one method by using syncTree
        */
        _syncPath: function(path, forceReload) {
            return navReadyPromise.promise.then(function () {
                return mainTreeApi.syncTree({ path: path, forceReload: forceReload });
            });
        },
        
        reloadNode: function(node) {
            return navReadyPromise.promise.then(function () {
                return mainTreeApi.reloadNode(node);
            });
        },
        
        reloadSection: function(sectionAlias) {
            return navReadyPromise.promise.then(function () {
                mainTreeApi.clearCache({ section: sectionAlias });
                return mainTreeApi.load(sectionAlias);
            });
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#hideTree
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Hides the tree by hiding the containing dom element
         */
        hideTree: function() {

            if (appState.getGlobalState("isTablet") === true && !appState.getGlobalState("stickyNavigation")) {
                //reset it to whatever is in the url
                appState.setSectionState("currentSection", $routeParams.section);
                setMode("default-hidesectiontree");
            }

        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#showMenu
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Hides the tree by hiding the containing dom element.
         * This always returns a promise!
         *
         * @param {Event} event the click event triggering the method, passed from the DOM element
         */
        showMenu: function(args) {
            
            var self = this;

            return treeService.getMenu({ treeNode: args.node })
                .then(function(data) {

                    //check for a default
                    //NOTE: event will be undefined when a call to hideDialog is made so it won't re-load the default again.
                    // but perhaps there's a better way to deal with with an additional parameter in the args ? it works though.
                    if (data.defaultAlias && !args.skipDefault) {

                        var found = _.find(data.menuItems, function(item) {
                            return item.alias = data.defaultAlias;
                        });

                        if (found) {

                            //NOTE: This is assigning the current action node - this is not the same as the currently selected node!
                            appState.setMenuState("currentNode", args.node);

                            //ensure the current dialog is cleared before creating another!
                            if (currentDialog) {
                                dialogService.close(currentDialog);
                            }

                            var dialog = self.showDialog({
                                node: args.node,
                                action: found,
                                section: appState.getSectionState("currentSection")
                            });

                            //return the dialog this is opening.
                            return $q.resolve(dialog);
                        }
                    }

                    //there is no default or we couldn't find one so just continue showing the menu

                    setMode("menu");

                    appState.setMenuState("currentNode", args.node);
                    appState.setMenuState("menuActions", data.menuItems);
                    appState.setMenuState("dialogTitle", args.node.name);

                    //we're not opening a dialog, return null.
                    return $q.resolve(null);
                });
            
        },

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#hideMenu
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Hides the menu by hiding the containing dom element
         */
        hideMenu: function() {
            //SD: Would we ever want to access the last action'd node instead of clearing it here?
            appState.setMenuState("currentNode", null);
            appState.setMenuState("menuActions", []);
            setMode("tree");
        },

        /** Executes a given menu action */
        executeMenuAction: function (action, node, section) {

            if (!action) {
                throw "action cannot be null";
            }
            if (!node) {
                throw "node cannot be null";
            }
            if (!section) {
                throw "section cannot be null";
            }

            if (action.metaData && action.metaData["actionRoute"] && angular.isString(action.metaData["actionRoute"])) {
                //first check if the menu item simply navigates to a route
                var parts = action.metaData["actionRoute"].split("?");
                $location.path(parts[0]).search(parts.length > 1 ? parts[1] : "");
                this.hideNavigation();
                return;
            }
            else if (action.metaData && action.metaData["jsAction"] && angular.isString(action.metaData["jsAction"])) {

                //we'll try to get the jsAction from the injector
                var menuAction = action.metaData["jsAction"].split('.');
                if (menuAction.length !== 2) {

                    //if it is not two parts long then this most likely means that it's a legacy action
                    var js = action.metaData["jsAction"].replace("javascript:", "");
                    //there's not really a different way to acheive this except for eval
                    eval(js);
                }
                else {
                    var menuActionService = $injector.get(menuAction[0]);
                    if (!menuActionService) {
                        throw "The angular service " + menuAction[0] + " could not be found";
                    }

                    var method = menuActionService[menuAction[1]];

                    if (!method) {
                        throw "The method " + menuAction[1] + " on the angular service " + menuAction[0] + " could not be found";
                    }

                    method.apply(this, [{
                        //map our content object to a basic entity to pass in to the menu handlers,
                        //this is required for consistency since a menu item needs to be decoupled from a tree node since the menu can
                        //exist standalone in the editor for which it can only pass in an entity (not tree node).
                        entity: umbModelMapper.convertToEntityBasic(node),
                        action: action,
                        section: section,
                        treeAlias: treeService.getTreeAlias(node)
                    }]);
                }
            }
            else {
                service.showDialog({
                    node: node,
                    action: action,
                    section: section
                });
            }
        },
        

        /**
         * @ngdoc method
         * @name umbraco.services.navigationService#showDialog
         * @methodOf umbraco.services.navigationService
         *
         * @description
         * Opens a dialog, for a given action on a given tree node
         * uses the dialogService to inject the selected action dialog
         * into #dialog div.umb-panel-body
         * the path to the dialog view is determined by:
         * "views/" + current tree + "/" + action alias + ".html"
         * The dialog controller will get passed a scope object that is created here with the properties:
         *  scope.currentNode = the selected tree node
         *  scope.currentAction = the selected menu item
         *  so that the dialog controllers can use these properties
         *
         * @param {Object} args arguments passed to the function
         * @param {Scope} args.scope current scope passed to the dialog
         * @param {Object} args.action the clicked action containing `name` and `alias`
         */
        showDialog: function(args) {

            if (!args) {
                throw "showDialog is missing the args parameter";
            }
            if (!args.action) {
                throw "The args parameter must have an 'action' property as the clicked menu action object";
            }
            if (!args.node) {
                throw "The args parameter must have a 'node' as the active tree node";
            }

            //ensure the current dialog is cleared before creating another!
            if (currentDialog) {
                dialogService.close(currentDialog);
                currentDialog = null;
            }

            setMode("dialog");

            //NOTE: Set up the scope object and assign properties, this is legacy functionality but we have to live with it now.
            // we should be passing in currentNode and currentAction using 'dialogData' for the dialog, not attaching it to a scope.
            // This scope instance will be destroyed by the dialog so it cannot be a scope that exists outside of the dialog.
            // If a scope instance has been passed in, we'll have to create a child scope of it, otherwise a new root scope.
            var dialogScope = args.scope ? args.scope.$new() : $rootScope.$new();
            dialogScope.currentNode = args.node;
            dialogScope.currentAction = args.action;

            //the title might be in the meta data, check there first
            if (args.action.metaData["dialogTitle"]) {
                appState.setMenuState("dialogTitle", args.action.metaData["dialogTitle"]);
            }
            else {
                appState.setMenuState("dialogTitle", args.action.name);
            }

            var templateUrl;
            var iframe;

            if (args.action.metaData["actionUrl"]) {
                templateUrl = args.action.metaData["actionUrl"];
                iframe = true;
            }
            else if (args.action.metaData["actionView"]) {
                templateUrl = args.action.metaData["actionView"];
                iframe = false;
            }
            else {

                //by convention we will look into the /views/{treetype}/{action}.html
                // for example: /views/content/create.html

                //we will also check for a 'packageName' for the current tree, if it exists then the convention will be:
                // for example: /App_Plugins/{mypackage}/backoffice/{treetype}/create.html

                var treeAlias = treeService.getTreeAlias(args.node);
                var packageTreeFolder = treeService.getTreePackageFolder(treeAlias);

                if (!treeAlias) {
                    throw "Could not get tree alias for node " + args.node.id;
                }

                if (packageTreeFolder) {
                    templateUrl = Umbraco.Sys.ServerVariables.umbracoSettings.appPluginsPath +
                        "/" + packageTreeFolder +
                        "/backoffice/" + treeAlias + "/" + args.action.alias + ".html";
                }
                else {
                    templateUrl = "views/" + treeAlias + "/" + args.action.alias + ".html";
                }

                iframe = false;
            }

            //TODO: some action's want to launch a new window like live editing, we support this in the menu item's metadata with
            // a key called: "actionUrlMethod" which can be set to either: Dialog, BlankWindow. Normally this is always set to Dialog
            // if a URL is specified in the "actionUrl" metadata. For now I'm not going to implement launching in a blank window,
            // though would be v-easy, just not sure we want to ever support that?

            var dialog = dialogService.open(
                {
                    container: $("#dialog div.umb-modalcolumn-body"),
                    //The ONLY reason we're passing in scope to the dialogService (which is legacy functionality) is
                    // for backwards compatibility since many dialogs require $scope.currentNode or $scope.currentAction
                    // to exist
                    scope: dialogScope,
                    inline: true,
                    show: true,
                    iframe: iframe,
                    modalClass: "umb-dialog",
                    template: templateUrl,

                    //These will show up on the dialog controller's $scope under dialogOptions
                    currentNode: args.node,
                    currentAction: args.action,
                });

            //save the currently assigned dialog so it can be removed before a new one is created
            currentDialog = dialog;
            return dialog;
        },

        /**
	     * @ngdoc method
	     * @name umbraco.services.navigationService#hideDialog
	     * @methodOf umbraco.services.navigationService
	     *
	     * @description
	     * hides the currently open dialog
	     */
        hideDialog: function (showMenu) {

            setMode("default");

            if(showMenu){
                this.showMenu(undefined, { skipDefault: true, node: appState.getMenuState("currentNode") });
            }
        },
        /**
          * @ngdoc method
          * @name umbraco.services.navigationService#showSearch
          * @methodOf umbraco.services.navigationService
          *
          * @description
          * shows the search pane
          */
        showSearch: function() {
            setMode("search");
        },
        /**
          * @ngdoc method
          * @name umbraco.services.navigationService#hideSearch
          * @methodOf umbraco.services.navigationService
          *
          * @description
          * hides the search pane
        */
        hideSearch: function() {
            setMode("default-hidesearch");
        },
        /**
          * @ngdoc method
          * @name umbraco.services.navigationService#hideNavigation
          * @methodOf umbraco.services.navigationService
          *
          * @description
          * hides any open navigation panes and resets the tree, actions and the currently selected node
          */
        hideNavigation: function() {
            appState.setMenuState("menuActions", []);
            setMode("default");
        }
    };

    return service;
}

angular.module('umbraco.services').factory('navigationService', navigationService);
