class AuthManager extends SFAuthManager {

  constructor(modelManager, singletonManager, storageManager, dbManager, httpManager, $rootScope, $timeout, $compile) {
    super(storageManager, httpManager, $timeout);
    this.$rootScope = $rootScope;
    this.$compile = $compile;
    this.modelManager = modelManager;
    this.singletonManager = singletonManager;
    this.storageManager = storageManager;
    this.dbManager = dbManager;
  }

  loadInitialData() {
    var userData = this.storageManager.getItemSync("user");
    if(userData) {
      this.user = JSON.parse(userData);
    } else {
      // legacy, check for uuid
      var idData = this.storageManager.getItemSync("uuid");
      if(idData) {
        this.user = {uuid: idData};
      }
    }

    this.configureUserPrefs();
    this.checkForSecurityUpdate();
  }

  offline() {
    return !this.user;
  }

  isEphemeralSession() {
    if(this.ephemeral == null || this.ephemeral == undefined) {
      this.ephemeral = JSON.parse(this.storageManager.getItemSync("ephemeral", StorageManager.Fixed));
    }
    return this.ephemeral;
  }

  setEphemeral(ephemeral) {
    this.ephemeral = ephemeral;
    if(ephemeral) {
      this.storageManager.setModelStorageMode(StorageManager.Ephemeral);
      this.storageManager.setItemsMode(StorageManager.Ephemeral);
    } else {
      this.storageManager.setModelStorageMode(StorageManager.Fixed);
      this.storageManager.setItemsMode(this.storageManager.hasPasscode() ? StorageManager.FixedEncrypted : StorageManager.Fixed);
      this.storageManager.setItem("ephemeral", JSON.stringify(false), StorageManager.Fixed);
    }
  }

  getAuthParams() {
    if(!this._authParams) {
      this._authParams = JSON.parse(this.storageManager.getItemSync("auth_params"));
    }
    return this._authParams;
  }

  async protocolVersion() {
    var authParams = this.getAuthParams();
    if(authParams && authParams.version) {
      return authParams.version;
    }

    var keys = await this.keys();
    if(keys && keys.ak) {
      // If there's no version stored, and there's an ak, it has to be 002. Newer versions would have thier version stored in authParams.
      return "002";
    } else {
      return "001";
    }
  }

  async resolveResponseInTimeout(response) {
    return new Promise((resolve, reject) => {
      this.$timeout(() => {
        resolve(response);
      });
    });
  }

  async getAuthParamsForEmail(url, email, extraParams) {
    return super.getAuthParamsForEmail(url, email, extraParams);
  }

  async login(url, email, password, ephemeral, strictSignin, extraParams) {
    return super.login(url, email, password, strictSignin, extraParams).then((response) => {
      if(!response.error) {
        this.setEphemeral(ephemeral);
        this.handleAuthResponse(response, email, url, authParams, keys);
        this.checkForSecurityUpdate();
      }

      return this.resolveResponseInTimeout(response);
    })
  }

  async register(url, email, password, ephemeral) {
    super.register(url, email, password).then((response) => {
      if(!response.error) {
        this.setEphemeral(ephemeral);
      }
      return this.resolveResponseInTimeout(response);
    })
  }

  async changePassword(email, current_server_pw, newKeys, newAuthParams) {
    super.changePassword(email, current_server_pw, newKeys, newAuthParams).then((response) => {
      if(!response.error) {
        this.checkForSecurityUpdate();
      }
      return this.resolveResponseInTimeout(response);
    })
  }

  async handleAuthResponse(response, email, url, authParams, keys) {
    try {
      await super.handleAuthResponse(response, email, url, authParams, keys);
      this._authParams = authParams;
      this.user = response.user;
      this.storageManager.setItem("user", JSON.stringify(response.user));
    } catch (e) {
      this.dbManager.displayOfflineAlert();
    }
  }

  checkForSecurityUpdate() {
    if(this.offline()) {
      return false;
    }

    let latest = SFJS.version();
    let updateAvailable = this.protocolVersion() !== latest;
    if(updateAvailable !== this.securityUpdateAvailable) {
      this.securityUpdateAvailable = updateAvailable;
      this.$rootScope.$broadcast("security-update-status-changed");
    }

    return this.securityUpdateAvailable;
  }

  presentPasswordWizard(type) {
    var scope = this.$rootScope.$new(true);
    scope.type = type;
    var el = this.$compile( "<password-wizard type='type'></password-wizard>" )(scope);
    angular.element(document.body).append(el);
  }

  signOut() {
    this._keys = null;
    this.user = null;
    this._authParams = null;
  }


  /* User Preferences */

  configureUserPrefs() {
    let prefsContentType = "SN|UserPreferences";

    this.singletonManager.registerSingleton({content_type: prefsContentType}, (resolvedSingleton) => {
      this.userPreferences = resolvedSingleton;
      this.userPreferencesDidChange();
    }, (valueCallback) => {
      // Safe to create. Create and return object.
      var prefs = new SFItem({content_type: prefsContentType});
      this.modelManager.addItem(prefs);
      prefs.setDirty(true);
      this.$rootScope.sync("authManager singletonCreate");
      valueCallback(prefs);
    });
  }

  userPreferencesDidChange() {
    this.$rootScope.$broadcast("user-preferences-changed");
  }

  syncUserPreferences() {
    this.userPreferences.setDirty(true);
    this.$rootScope.sync("syncUserPreferences");
  }

  getUserPrefValue(key, defaultValue) {
    if(!this.userPreferences) { return defaultValue; }
    var value = this.userPreferences.getAppDataItem(key);
    return (value !== undefined && value != null) ? value : defaultValue;
  }

  setUserPrefValue(key, value, sync) {
    if(!this.userPreferences) { console.log("Prefs are null, not setting value", key); return; }
    this.userPreferences.setAppDataItem(key, value);
    if(sync) {
      this.syncUserPreferences();
    }
  }
});

angular.module('app').service('authManager', AuthManager);
