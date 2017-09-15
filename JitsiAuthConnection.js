import {
    CONNECTION_DISCONNECTED,
    CONNECTION_ESTABLISHED,
    CONNECTION_FAILED
} from './JitsiConnectionEvents';
import XMPP from './modules/xmpp/xmpp';

/**
 * <tt>JitsiAuthConnection</tt> creates a separate XMPP connection and tries to
 * connect using specific credentials. Once connected, it will contact Jicofo to
 * obtain and store the session ID which will then be used by the parent
 * conference to upgrade the user's role to moderator. It's also used to join
 * the conference when starting from anonymous domain and only authenticated
 * users are allowed to create new rooms.
 */
export default class JitsiAuthConnection {
    /**
     * Initializes a new <tt>JitsiAuthConnection</tt> instance for a specific
     * conference.
     *
     * @constructor
     * @param {JitsiConference} conference
     */
    constructor(conference) {
        this.conference = conference;

        this.xmpp = new XMPP(conference.connection.options);
        this.canceled = false;
        this._promise = null;
    }

    /**
     * @typedef {Object} UpgradeRoleError
     *
     * @property {JitsiConnectionErrors} [connectionError] - One of
     * {@link JitsiConnectionErrors} which occurred when trying to connect to
     * the XMPP server.
     * @property {String} [authenticationError] - One of XMPP error conditions
     * returned by Jicofo on authentication attempt. See
     * https://xmpp.org/rfcs/rfc3920.html#streams-error.
     * @property {String} [message] - More details about the error.
     *
     * NOTE If neither one of the errors is present, then the operation has been
     * canceled.
     */

    /**
     * Connects to the XMPP server using the specified credentials and contacts
     * Jicofo in order to obtain a session ID (which is then stored in the local
     * storage). The user's role of the parent conference will be upgraded to
     * moderator (by Jicofo).
     *
     * @param {Object} options
     * @param {string} options.id - XMPP user's ID to log in. For example,
     * user@xmpp-server.com.
     * @param {string} options.password - XMPP user's password to log in with.
     * @param {string} [options.roomPassword] - The password to join the MUC
     * with.
     * @param {Function} [options.onLoginSuccessful] - Callback called when
     * logging into the XMPP server was successful. The next step will be to
     * obtain a new session ID from Jicofo and join the MUC using it which will
     * effectively upgrade the user's role to moderator.
     * @returns {Promise} Resolved in case the authentication was successful
     * and the session ID has been stored in the settings. Will be rejected with
     * {@link UpgradeRoleError} which will have either <tt>connectionError</tt>
     * or <tt>authenticationError</tt> property set depending on which of the
     * steps has failed. If {@link cancel} is called before the operation is
     * finished, then the promise will be rejected with an empty object (i.e. no
     * error set).
     */
    authenticateAndUpgradeRole({
        // 1. Log the specified XMPP user in.
        id,
        password,

        // 2. Let the API client/consumer know as soon as the XMPP user has been
        //    successfully logged in.
        onLoginSuccessful,

        // 3. Join the MUC.
        roomPassword
    }) {
        if (this._promise) {
            return this._promise;
        }

        this._promise = new Promise((resolve, reject) => {
            const connectionEstablished = () => {
                if (this.canceled) {
                    return;
                }

                // Let the caller know that the XMPP login was successful.
                onLoginSuccessful && onLoginSuccessful();

                // Now authenticate with Jicofo and get a new session ID.
                this.room
                    = this.xmpp.createRoom(
                        this.conference.options.name,
                        this.conference.options.config);
                this.room.moderator.authenticate()
                    .then(() => {
                        if (this.canceled) {
                            return;
                        }

                        this.xmpp.disconnect();

                        // At this point we should have the new session ID
                        // stored in the settings. Jicofo will allow to join the
                        // room.
                        this.conference.join(roomPassword);

                        resolve();
                    })
                    .catch(({ error, message }) => {
                        this.xmpp.disconnect();

                        reject({
                            authenticationError: error,
                            message
                        });
                    });
            };

            this.xmpp.addListener(
                CONNECTION_ESTABLISHED,
                connectionEstablished);
            this.xmpp.addListener(
                CONNECTION_FAILED,
                (connectionError, message) => reject({
                    connectionError,
                    message
                }));
            this.xmpp.addListener(
                CONNECTION_DISCONNECTED,
                () => {
                    if (this.canceled) {
                        reject({});
                    }
                });

            if (this.canceled) {
                reject({});
            } else {
                this.xmpp.connect(id, password);
            }
        });

        return this._promise;
    }

    /**
     * Cancels the authentication if it's currently in progress. The promise
     * returned by {@link authenticateAndUpgradeRole} will be rejected with an
     * empty object (i.e. none of the error fields set).
     */
    cancel() {
        this.canceled = true;
        this.xmpp.disconnect();
    }
}
