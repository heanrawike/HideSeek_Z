pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HideSeekGame is ZamaEthereumConfig {
    struct Player {
        address playerAddress;
        euint32 encryptedX;
        euint32 encryptedY;
        uint32 lastDecryptedX;
        uint32 lastDecryptedY;
        uint256 lastMoveTime;
        bool isActive;
    }

    struct GameSession {
        string sessionId;
        uint256 startTime;
        uint256 duration;
        uint32 boundaryX;
        uint32 boundaryY;
        uint32 triggerDistance;
        bool isActive;
        mapping(address => Player) players;
        address[] playerAddresses;
    }

    mapping(string => GameSession) public gameSessions;
    string[] public sessionIds;

    event PlayerJoined(string indexed sessionId, address indexed player);
    event PlayerMoved(string indexed sessionId, address indexed player);
    event ProximityTriggered(string indexed sessionId, address player1, address player2);
    event SessionCreated(string indexed sessionId, address indexed creator);
    event SessionEnded(string indexed sessionId);

    modifier sessionActive(string memory sessionId) {
        GameSession storage session = gameSessions[sessionId];
        require(session.isActive, "Session not active");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function createSession(
        string calldata sessionId,
        uint256 duration,
        uint32 boundaryX,
        uint32 boundaryY,
        uint32 triggerDistance
    ) external {
        require(gameSessions[sessionId].startTime == 0, "Session already exists");
        require(boundaryX > 0 && boundaryY > 0, "Invalid boundaries");
        require(triggerDistance > 0, "Invalid trigger distance");

        gameSessions[sessionId] = GameSession({
        startTime: block.timestamp,
        duration: duration,
        boundaryX: boundaryX,
        boundaryY: boundaryY,
        triggerDistance: triggerDistance,
        isActive: true
        });

        sessionIds.push(sessionId);
        emit SessionCreated(sessionId, msg.sender);
    }

    function joinSession(
        string calldata sessionId,
        externalEuint32 encryptedX,
        bytes calldata xProof,
        externalEuint32 encryptedY,
        bytes calldata yProof
    ) external sessionActive(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        require(session.players[msg.sender].playerAddress == address(0), "Player already joined");

        require(FHE.isInitialized(FHE.fromExternal(encryptedX, xProof)), "Invalid encrypted X");
        require(FHE.isInitialized(FHE.fromExternal(encryptedY, yProof)), "Invalid encrypted Y");

        session.players[msg.sender] = Player({
        playerAddress: msg.sender,
        encryptedX: FHE.fromExternal(encryptedX, xProof),
        encryptedY: FHE.fromExternal(encryptedY, yProof),
        lastDecryptedX: 0,
        lastDecryptedY: 0,
        lastMoveTime: block.timestamp,
        isActive: true
        });

        FHE.allowThis(session.players[msg.sender].encryptedX);
        FHE.allowThis(session.players[msg.sender].encryptedY);
        FHE.makePubliclyDecryptable(session.players[msg.sender].encryptedX);
        FHE.makePubliclyDecryptable(session.players[msg.sender].encryptedY);

        session.playerAddresses.push(msg.sender);
        emit PlayerJoined(sessionId, msg.sender);
    }

    function movePlayer(
        string calldata sessionId,
        externalEuint32 encryptedX,
        bytes calldata xProof,
        externalEuint32 encryptedY,
        bytes calldata yProof
    ) external sessionActive(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        Player storage player = session.players[msg.sender];
        require(player.isActive, "Player not active");

        require(FHE.isInitialized(FHE.fromExternal(encryptedX, xProof)), "Invalid encrypted X");
        require(FHE.isInitialized(FHE.fromExternal(encryptedY, yProof)), "Invalid encrypted Y");

        player.encryptedX = FHE.fromExternal(encryptedX, xProof);
        player.encryptedY = FHE.fromExternal(encryptedY, yProof);
        player.lastMoveTime = block.timestamp;

        FHE.allowThis(player.encryptedX);
        FHE.allowThis(player.encryptedY);
        FHE.makePubliclyDecryptable(player.encryptedX);
        FHE.makePubliclyDecryptable(player.encryptedY);

        emit PlayerMoved(sessionId, msg.sender);
    }

    function checkProximity(
        string calldata sessionId,
        address player1,
        address player2,
        bytes memory player1XProof,
        bytes memory player1YProof,
        bytes memory player2XProof,
        bytes memory player2YProof
    ) external sessionActive(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        Player storage p1 = session.players[player1];
        Player storage p2 = session.players[player2];

        require(p1.isActive && p2.isActive, "Players not active");

        bytes32[] memory cts = new bytes32[](4);
        cts[0] = FHE.toBytes32(p1.encryptedX);
        cts[1] = FHE.toBytes32(p1.encryptedY);
        cts[2] = FHE.toBytes32(p2.encryptedX);
        cts[3] = FHE.toBytes32(p2.encryptedY);

        bytes memory decryptedValues = FHE.checkSignatures(cts, abi.encode(0), player1XProof);
        (p1.lastDecryptedX) = abi.decode(decryptedValues, (uint32));

        decryptedValues = FHE.checkSignatures(cts, abi.encode(0), player1YProof);
        (p1.lastDecryptedY) = abi.decode(decryptedValues, (uint32));

        decryptedValues = FHE.checkSignatures(cts, abi.encode(0), player2XProof);
        (p2.lastDecryptedX) = abi.decode(decryptedValues, (uint32));

        decryptedValues = FHE.checkSignatures(cts, abi.encode(0), player2YProof);
        (p2.lastDecryptedY) = abi.decode(decryptedValues, (uint32));

        uint32 dx = p1.lastDecryptedX > p2.lastDecryptedX ? p1.lastDecryptedX - p2.lastDecryptedX : p2.lastDecryptedX - p1.lastDecryptedX;
        uint32 dy = p1.lastDecryptedY > p2.lastDecryptedY ? p1.lastDecryptedY - p2.lastDecryptedY : p2.lastDecryptedY - p1.lastDecryptedY;

        if (dx <= session.triggerDistance && dy <= session.triggerDistance) {
            emit ProximityTriggered(sessionId, player1, player2);
        }
    }

    function endSession(string calldata sessionId) external sessionActive(sessionId) {
        GameSession storage session = gameSessions[sessionId];
        session.isActive = false;
        emit SessionEnded(sessionId);
    }

    function getSessionPlayers(string calldata sessionId) external view returns (address[] memory) {
        return gameSessions[sessionId].playerAddresses;
    }

    function getPlayerLocation(string calldata sessionId, address player) external view returns (euint32, euint32) {
        Player storage p = gameSessions[sessionId].players[player];
        require(p.playerAddress != address(0), "Player not found");
        return (p.encryptedX, p.encryptedY);
    }

    function getDecryptedLocation(string calldata sessionId, address player) external view returns (uint32, uint32) {
        Player storage p = gameSessions[sessionId].players[player];
        require(p.playerAddress != address(0), "Player not found");
        return (p.lastDecryptedX, p.lastDecryptedY);
    }
}


