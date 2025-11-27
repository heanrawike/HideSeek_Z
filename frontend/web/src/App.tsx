import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface GameEvent {
  id: string;
  name: string;
  encryptedLocation: string;
  publicRadius: number;
  description: string;
  creator: string;
  timestamp: number;
  isTriggered: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEventData, setNewEventData] = useState({ name: "", location: "", radius: "" });
  const [selectedEvent, setSelectedEvent] = useState<GameEvent | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [playerPositions, setPlayerPositions] = useState<{id: string, x: number, y: number}[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM init failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };
    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
        generateRandomPlayerPositions();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadDataAndContract();
  }, [isConnected]);

  const generateRandomPlayerPositions = () => {
    const positions = [];
    for (let i = 0; i < 8; i++) {
      positions.push({
        id: `player-${i}`,
        x: Math.floor(Math.random() * 100),
        y: Math.floor(Math.random() * 100)
      });
    }
    setPlayerPositions(positions);
  };

  const loadData = async () => {
    if (!isConnected) return;
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const businessIds = await contract.getAllBusinessIds();
      const eventsList: GameEvent[] = [];
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          eventsList.push({
            id: businessId,
            name: businessData.name,
            encryptedLocation: businessId,
            publicRadius: Number(businessData.publicValue1) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isTriggered: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading event data:', e);
        }
      }
      setEvents(eventsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createEvent = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    setCreatingEvent(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating event with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      const locationValue = parseInt(newEventData.location) || 0;
      const eventId = `event-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, locationValue);
      const tx = await contract.createBusinessData(
        eventId,
        newEventData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newEventData.radius) || 10,
        0,
        "HideSeek Event"
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      setTransactionStatus({ visible: true, status: "success", message: "Event created!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      await loadData();
      setShowCreateModal(false);
      setNewEventData({ name: "", location: "", radius: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingEvent(false); 
    }
  };

  const decryptData = async (eventId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      const businessData = await contractRead.getBusinessData(eventId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      const encryptedValueHandle = await contractRead.getEncryptedValue(eventId);
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(eventId, abiEncodedClearValues, decryptionProof)
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "System available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  const renderGameMap = () => {
    return (
      <div className="game-map-container">
        <div className="map-grid">
          {Array.from({ length: 100 }).map((_, index) => (
            <div key={index} className="map-cell"></div>
          ))}
          {playerPositions.map((player, index) => (
            <div 
              key={player.id}
              className="player-marker"
              style={{
                left: `${player.x}%`,
                top: `${player.y}%`,
                backgroundColor: index === 0 ? '#ff6b35' : '#1a936f'
              }}
            ></div>
          ))}
          {events.map(event => (
            <div 
              key={event.id}
              className={`event-marker ${event.isTriggered ? 'triggered' : ''}`}
              style={{
                left: `${Math.random() * 90 + 5}%`,
                top: `${Math.random() * 90 + 5}%`
              }}
              onClick={() => setSelectedEvent(event)}
            ></div>
          ))}
        </div>
        <div className="radar-container">
          <div className="radar-sweep"></div>
          {playerPositions.map((player, index) => (
            <div 
              key={`radar-${player.id}`}
              className="radar-blip"
              style={{
                left: `${50 + (player.x - 50) * 0.3}%`,
                top: `${50 + (player.y - 50) * 0.3}%`,
                backgroundColor: index === 0 ? '#ff6b35' : '#1a936f'
              }}
            ></div>
          ))}
        </div>
      </div>
    );
  };

  const renderLeaderboard = () => {
    return (
      <div className="leaderboard-container">
        <h3>Top Seekers</h3>
        <div className="leaderboard-list">
          {playerPositions.slice(0, 5).map((player, index) => (
            <div key={`leader-${player.id}`} className="leaderboard-item">
              <span className="rank">{index + 1}</span>
              <span className="player-id">Player {index + 1}</span>
              <span className="score">{Math.floor(Math.random() * 1000)} pts</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderEventFeed = () => {
    return (
      <div className="event-feed-container">
        <h3>Recent Activity</h3>
        <div className="feed-items">
          {events.slice(0, 3).map(event => (
            <div key={`feed-${event.id}`} className="feed-item">
              <div className="feed-icon">🔍</div>
              <div className="feed-content">
                <strong>{event.name}</strong>
                <p>{event.description}</p>
                <small>{new Date(event.timestamp * 1000).toLocaleTimeString()}</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>HideSeek_Z 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Wallet to Play</h2>
            <p>Use your wallet to start playing the encrypted location-based game</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading game data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>HideSeek_Z 🔐</h1>
        </div>
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Event
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="game-section">
          {renderGameMap()}
        </div>
        
        <div className="sidebar">
          {renderLeaderboard()}
          {renderEventFeed()}
        </div>
      </div>
      
      <div className="events-grid">
        <h2>Active Events</h2>
        <div className="events-list">
          {events.length === 0 ? (
            <div className="no-events">
              <p>No events found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Event
              </button>
            </div>
          ) : events.map((event, index) => (
            <div 
              key={index} 
              className={`event-card ${event.isTriggered ? 'triggered' : ''}`}
              onClick={() => setSelectedEvent(event)}
            >
              <div className="event-title">{event.name}</div>
              <div className="event-meta">
                <span>Radius: {event.publicRadius}m</span>
                <span>{new Date(event.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              <div className="event-status">
                {event.isTriggered ? "✅ Triggered" : "🔓 Active"}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-event-modal">
            <div className="modal-header">
              <h2>New HideSeek Event</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Event Name *</label>
                <input 
                  type="text" 
                  name="name" 
                  value={newEventData.name} 
                  onChange={(e) => setNewEventData({...newEventData, name: e.target.value})} 
                  placeholder="Event name..." 
                />
              </div>
              <div className="form-group">
                <label>Encrypted Location (Integer) *</label>
                <input 
                  type="number" 
                  name="location" 
                  value={newEventData.location} 
                  onChange={(e) => setNewEventData({...newEventData, location: e.target.value})} 
                  placeholder="Location value..." 
                />
                <div className="data-type-label">FHE Encrypted</div>
              </div>
              <div className="form-group">
                <label>Trigger Radius (meters) *</label>
                <input 
                  type="number" 
                  name="radius" 
                  value={newEventData.radius} 
                  onChange={(e) => setNewEventData({...newEventData, radius: e.target.value})} 
                  placeholder="Radius..." 
                />
                <div className="data-type-label">Public Data</div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createEvent} 
                disabled={creatingEvent || isEncrypting || !newEventData.name || !newEventData.location || !newEventData.radius} 
                className="submit-btn"
              >
                {creatingEvent || isEncrypting ? "Creating..." : "Create Event"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedEvent && (
        <div className="modal-overlay">
          <div className="event-detail-modal">
            <div className="modal-header">
              <h2>Event Details</h2>
              <button onClick={() => setSelectedEvent(null)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="event-info">
                <div className="info-item">
                  <span>Name:</span>
                  <strong>{selectedEvent.name}</strong>
                </div>
                <div className="info-item">
                  <span>Creator:</span>
                  <strong>{selectedEvent.creator.substring(0, 6)}...{selectedEvent.creator.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Trigger Radius:</span>
                  <strong>{selectedEvent.publicRadius}m</strong>
                </div>
                <div className="info-item">
                  <span>Status:</span>
                  <strong>{selectedEvent.isTriggered ? "Triggered" : "Active"}</strong>
                </div>
              </div>
              
              <div className="data-section">
                <h3>Encrypted Location Data</h3>
                <div className="data-row">
                  <div className="data-label">Location Value:</div>
                  <div className="data-value">
                    {selectedEvent.isTriggered && selectedEvent.decryptedValue ? 
                      `${selectedEvent.decryptedValue} (Verified)` : 
                      decryptedData !== null ? 
                      `${decryptedData} (Decrypted)` : 
                      "🔒 Encrypted"
                    }
                  </div>
                  <button 
                    className={`decrypt-btn ${(selectedEvent.isTriggered || decryptedData !== null) ? 'decrypted' : ''}`}
                    onClick={async () => {
                      if (decryptedData !== null) {
                        setDecryptedData(null);
                      } else {
                        const result = await decryptData(selectedEvent.id);
                        setDecryptedData(result);
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? "Decrypting..." : 
                     selectedEvent.isTriggered ? "✅ Verified" : 
                     decryptedData !== null ? "🔄 Re-decrypt" : "🔓 Decrypt"}
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedEvent(null)} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;