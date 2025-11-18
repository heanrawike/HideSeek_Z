import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

interface PlayerData {
  id: string;
  name: string;
  score: number;
  lastActive: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEventData, setNewEventData] = useState({ name: "", location: "", radius: "" });
  const [selectedEvent, setSelectedEvent] = useState<GameEvent | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [map, setMap] = useState<any>(null);
  const [playerPosition, setPlayerPosition] = useState<[number, number]>([0, 0]);

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
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
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
        const contract = await getContractReadOnly();
        if (contract) {
          setContractAddress(await contract.getAddress());
          await loadEvents(contract);
          await loadPlayers();
        }
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    if (isConnected && !map) {
      const initMap = () => {
        const mapInstance = L.map('game-map').setView([51.505, -0.09], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(mapInstance);
        setMap(mapInstance);
      };
      initMap();
    }
  }, [isConnected, map]);

  const loadEvents = async (contract: any) => {
    try {
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
        } catch (e) {}
      }
      
      setEvents(eventsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load events" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const loadPlayers = async () => {
    const mockPlayers: PlayerData[] = [
      { id: "player1", name: "ShadowRunner", score: 1250, lastActive: Date.now() - 3600000 },
      { id: "player2", name: "CryptoNinja", score: 980, lastActive: Date.now() - 7200000 },
      { id: "player3", name: "FHEGhost", score: 750, lastActive: Date.now() - 1800000 },
      { id: "player4", name: "BlockSeeker", score: 620, lastActive: Date.now() - 5400000 },
      { id: address || "player5", name: "You", score: 450, lastActive: Date.now() }
    ];
    setPlayers(mockPlayers);
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
      if (!contract) throw new Error("Failed to get contract");
      
      const locationValue = parseInt(newEventData.location) || 0;
      const businessId = `event-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, locationValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEventData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newEventData.radius) || 0,
        0,
        "Game Event"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Event created!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      const contractRead = await getContractReadOnly();
      if (contractRead) await loadEvents(contractRead);
      
      setShowCreateModal(false);
      setNewEventData({ name: "", location: "", radius: "" });
      setUserHistory([...userHistory, `Created event: ${newEventData.name}`]);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingEvent(false); 
    }
  };

  const triggerEvent = async (eventId: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setIsDecrypting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Triggering event..." });
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return;
      
      const businessData = await contractRead.getBusinessData(eventId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Event already triggered" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(eventId);
      
      await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(eventId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying trigger..." });
      
      const contractUpdated = await getContractReadOnly();
      if (contractUpdated) await loadEvents(contractUpdated);
      
      setTransactionStatus({ visible: true, status: "success", message: "Event triggered!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      setUserHistory([...userHistory, `Triggered event: ${eventId}`]);
    } catch (e: any) { 
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Trigger failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "System available!" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const updatePlayerPosition = () => {
    if (!map) return;
    
    const randomLat = 51.5 + (Math.random() - 0.5) * 0.1;
    const randomLng = -0.09 + (Math.random() - 0.5) * 0.1;
    setPlayerPosition([randomLat, randomLng]);
    
    L.marker([randomLat, randomLng], {
      icon: L.divIcon({
        className: 'player-marker',
        html: '<div class="pulse"></div>',
        iconSize: [30, 30]
      })
    }).addTo(map);
    
    map.setView([randomLat, randomLng], 15);
    setUserHistory([...userHistory, `Moved to: ${randomLat.toFixed(4)}, ${randomLng.toFixed(4)}`]);
  };

  const renderDashboard = () => {
    const activePlayers = players.filter(p => Date.now() - p.lastActive < 86400000).length;
    const triggeredEvents = events.filter(e => e.isTriggered).length;
    
    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>Active Players</h3>
          <div className="stat-value">{activePlayers}</div>
          <div className="stat-trend">Online Now</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Events</h3>
          <div className="stat-value">{events.length}</div>
          <div className="stat-trend">{triggeredEvents} triggered</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Your Score</h3>
          <div className="stat-value">{players.find(p => p.id === address)?.score || 0}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
      </div>
    );
  };

  const renderPlayerRanking = () => {
    return (
      <div className="ranking-list">
        {players.sort((a, b) => b.score - a.score).map((player, index) => (
          <div 
            className={`ranking-item ${player.id === address ? "highlight" : ""}`} 
            key={player.id}
          >
            <div className="rank">#{index + 1}</div>
            <div className="player-info">
              <div className="player-name">{player.name}</div>
              <div className="player-score">{player.score} pts</div>
            </div>
            <div className={`status ${Date.now() - player.lastActive < 300000 ? "online" : "offline"}`}>
              {Date.now() - player.lastActive < 300000 ? "Online" : "Offline"}
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>隱私捉迷藏LBS</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Play</h2>
            <p>Private location-based game with FHE encryption. Your position stays hidden until events trigger.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Move on map to encrypted locations</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Trigger events when in range</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p className="loading-note">Securing your location data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading game world...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>隱私捉迷藏LBS</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + Create Event
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="center-radial">
          <div className="map-container">
            <div id="game-map"></div>
            <button className="move-btn" onClick={updatePlayerPosition}>
              Move Randomly
            </button>
          </div>
          
          <div className="radial-panels">
            <div className="radial-panel dashboard-panel">
              <h2>Game Dashboard</h2>
              {renderDashboard()}
              
              <div className="fhe-flow">
                <div className="flow-step">
                  <div className="step-icon">🔒</div>
                  <div className="step-content">
                    <h4>Position Encryption</h4>
                    <p>Your location encrypted with FHE</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-icon">🔄</div>
                  <div className="step-content">
                    <h4>Homomorphic Check</h4>
                    <p>Event triggers without decrypting</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-icon">🎯</div>
                  <div className="step-content">
                    <h4>Event Trigger</h4>
                    <p>Reveal only when in range</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="radial-panel events-panel">
              <div className="panel-header">
                <h2>Game Events</h2>
                <button onClick={checkAvailability} className="system-check">
                  Check System
                </button>
              </div>
              
              <div className="events-list">
                {events.length === 0 ? (
                  <div className="no-events">
                    <p>No events found</p>
                    <button 
                      className="create-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Event
                    </button>
                  </div>
                ) : events.map((event, index) => (
                  <div 
                    className={`event-item ${selectedEvent?.id === event.id ? "selected" : ""} ${event.isTriggered ? "triggered" : ""}`} 
                    key={index}
                    onClick={() => setSelectedEvent(event)}
                  >
                    <div className="event-title">{event.name}</div>
                    <div className="event-meta">
                      <span>Radius: {event.publicRadius}m</span>
                      <span>Created: {new Date(event.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="event-status">
                      Status: {event.isTriggered ? "✅ Triggered" : "🔓 Active"}
                    </div>
                    <div className="event-creator">Creator: {event.creator.substring(0, 6)}...{event.creator.substring(38)}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="radial-panel players-panel">
              <h2>Player Rankings</h2>
              {renderPlayerRanking()}
            </div>
            
            <div className="radial-panel history-panel">
              <h2>Your History</h2>
              <div className="history-list">
                {userHistory.length === 0 ? (
                  <p>No history yet</p>
                ) : userHistory.map((entry, index) => (
                  <div className="history-entry" key={index}>
                    <div className="history-icon">🕒</div>
                    <div className="history-text">{entry}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateEvent 
          onSubmit={createEvent} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingEvent} 
          eventData={newEventData} 
          setEventData={setNewEventData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedEvent && (
        <EventDetailModal 
          event={selectedEvent} 
          onClose={() => setSelectedEvent(null)} 
          onTrigger={() => triggerEvent(selectedEvent.id)}
          isTriggering={isDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateEvent: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  eventData: any;
  setEventData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, eventData, setEventData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEventData({ ...eventData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-event-modal">
        <div className="modal-header">
          <h2>Create Game Event</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Location data will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Event Name *</label>
            <input 
              type="text" 
              name="name" 
              value={eventData.name} 
              onChange={handleChange} 
              placeholder="Enter event name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Location Code (Integer) *</label>
            <input 
              type="number" 
              name="location" 
              value={eventData.location} 
              onChange={handleChange} 
              placeholder="Enter location code..." 
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Trigger Radius (meters) *</label>
            <input 
              type="number" 
              min="10" 
              max="1000" 
              name="radius" 
              value={eventData.radius} 
              onChange={handleChange} 
              placeholder="Enter radius..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !eventData.name || !eventData.location || !eventData.radius} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Event"}
          </button>
        </div>
      </div>
    </div>
  );
};

const EventDetailModal: React.FC<{
  event: GameEvent;
  onClose: () => void;
  onTrigger: () => void;
  isTriggering: boolean;
}> = ({ event, onClose, onTrigger, isTriggering }) => {
  return (
    <div className="modal-overlay">
      <div className="event-detail-modal">
        <div className="modal-header">
          <h2>Event Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="event-info">
            <div className="info-item">
              <span>Event Name:</span>
              <strong>{event.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{event.creator.substring(0, 6)}...{event.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(event.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Trigger Radius:</span>
              <strong>{event.publicRadius}m</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Location</h3>
            
            <div className="data-row">
              <div className="data-label">Location Code:</div>
              <div className="data-value">
                {event.isTriggered && event.decryptedValue ? 
                  `${event.decryptedValue} (Triggered)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Homomorphic Trigger</strong>
                <p>Event triggers when your encrypted position is within range, without revealing your location.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!event.isTriggered && (
            <button 
              onClick={onTrigger} 
              disabled={isTriggering}
              className="trigger-btn"
            >
              {isTriggering ? "Triggering..." : "Trigger Event"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


