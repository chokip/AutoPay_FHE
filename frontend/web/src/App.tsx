import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface AutoPayData {
  id: number;
  name: string;
  paymentAmount: string;
  triggerCondition: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface PaymentStats {
  totalPayments: number;
  activeSubscriptions: number;
  avgAmount: number;
  successRate: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [autoPays, setAutoPays] = useState<AutoPayData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAutoPay, setCreatingAutoPay] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newAutoPayData, setNewAutoPayData] = useState({ name: "", amount: "", condition: "" });
  const [selectedAutoPay, setSelectedAutoPay] = useState<AutoPayData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ amount: number | null; condition: number | null }>({ amount: null, condition: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) {
        return;
      }
      
      if (isInitialized) {
        return;
      }
      
      if (fhevmInitializing) {
        return;
      }
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
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
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const autoPaysList: AutoPayData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          autoPaysList.push({
            id: parseInt(businessId.replace('autopay-', '')) || Date.now(),
            name: businessData.name,
            paymentAmount: businessId,
            triggerCondition: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAutoPays(autoPaysList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAutoPay = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAutoPay(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating auto-pay with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newAutoPayData.amount) || 0;
      const businessId = `autopay-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAutoPayData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newAutoPayData.condition) || 0,
        0,
        "Auto-Pay Condition"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Auto-pay created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAutoPayData({ name: "", amount: "", condition: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAutoPay(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const calculateStats = (): PaymentStats => {
    const totalPayments = autoPays.length;
    const activeSubscriptions = autoPays.filter(ap => ap.publicValue1 > 0).length;
    const totalAmount = autoPays.reduce((sum, ap) => sum + (ap.decryptedValue || 0), 0);
    const avgAmount = totalPayments > 0 ? totalAmount / totalPayments : 0;
    const successRate = totalPayments > 0 ? (autoPays.filter(ap => ap.isVerified).length / totalPayments) * 100 : 0;

    return {
      totalPayments,
      activeSubscriptions,
      avgAmount,
      successRate
    };
  };

  const renderStatsDashboard = () => {
    const stats = calculateStats();
    
    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <div className="stat-icon">💰</div>
          <h3>Total Payments</h3>
          <div className="stat-value">{stats.totalPayments}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="panel metal-panel">
          <div className="stat-icon">🔄</div>
          <h3>Active Subscriptions</h3>
          <div className="stat-value">{stats.activeSubscriptions}</div>
          <div className="stat-trend">Auto-Triggered</div>
        </div>
        
        <div className="panel metal-panel">
          <div className="stat-icon">📊</div>
          <h3>Avg Amount</h3>
          <div className="stat-value">{stats.avgAmount.toFixed(1)}</div>
          <div className="stat-trend">Encrypted Average</div>
        </div>
        
        <div className="panel metal-panel">
          <div className="stat-icon">✅</div>
          <h3>Success Rate</h3>
          <div className="stat-value">{stats.successRate.toFixed(1)}%</div>
          <div className="stat-trend">Verified Transactions</div>
        </div>
      </div>
    );
  };

  const renderPaymentChart = () => {
    const verifiedCount = autoPays.filter(ap => ap.isVerified).length;
    const pendingCount = autoPays.length - verifiedCount;
    
    return (
      <div className="chart-container">
        <h3>Payment Verification Status</h3>
        <div className="chart-bars">
          <div className="chart-bar-group">
            <div className="bar-label">Verified</div>
            <div className="bar-container">
              <div 
                className="bar-fill verified" 
                style={{ width: `${autoPays.length > 0 ? (verifiedCount / autoPays.length) * 100 : 0}%` }}
              >
                <span className="bar-value">{verifiedCount}</span>
              </div>
            </div>
          </div>
          <div className="chart-bar-group">
            <div className="bar-label">Pending</div>
            <div className="bar-container">
              <div 
                className="bar-fill pending" 
                style={{ width: `${autoPays.length > 0 ? (pendingCount / autoPays.length) * 100 : 0}%` }}
              >
                <span className="bar-value">{pendingCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredAutoPays = autoPays.filter(ap => 
    ap.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ap.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Auto-Pay FAQ</h3>
      <div className="faq-list">
        <div className="faq-item">
          <h4>What is FHE-based Auto-Pay?</h4>
          <p>Fully Homomorphic Encryption allows automatic payments while keeping amount and conditions encrypted.</p>
        </div>
        <div className="faq-item">
          <h4>How does encryption work?</h4>
          <p>Payment amounts are encrypted using Zama FHE before being stored on-chain, ensuring complete privacy.</p>
        </div>
        <div className="faq-item">
          <h4>Is my data secure?</h4>
          <p>Yes, all sensitive data remains encrypted even during computation through homomorphic operations.</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 FHE Auto-Pay</h1>
            <span className="tagline">Privacy-Preserving Automatic Payments</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Secure your automatic payments with fully homomorphic encryption technology.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize the FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted auto-pay conditions</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Enjoy privacy-preserving automatic payments</p>
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
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your payment data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted payment system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 FHE Auto-Pay</h1>
          <span className="tagline">Encrypted Automatic Payments</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Auto-Pay
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-btn metal-btn"
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Encrypted Payment Analytics</h2>
          {renderStatsDashboard()}
          
          <div className="chart-panel metal-panel">
            {renderPaymentChart()}
          </div>
        </div>
        
        {showFAQ && (
          <div className="faq-panel metal-panel">
            {renderFAQ()}
          </div>
        )}
        
        <div className="payments-section">
          <div className="section-header">
            <h2>Auto-Pay Conditions</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search payments..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="payments-list">
            {filteredAutoPays.length === 0 ? (
              <div className="no-payments">
                <p>No auto-pay conditions found</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Auto-Pay
                </button>
              </div>
            ) : filteredAutoPays.map((autoPay, index) => (
              <div 
                className={`payment-item ${selectedAutoPay?.id === autoPay.id ? "selected" : ""} ${autoPay.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedAutoPay(autoPay)}
              >
                <div className="payment-header">
                  <div className="payment-title">{autoPay.name}</div>
                  <div className={`status-badge ${autoPay.isVerified ? "verified" : "pending"}`}>
                    {autoPay.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </div>
                </div>
                <div className="payment-meta">
                  <span>Condition: {autoPay.publicValue1}</span>
                  <span>Created: {new Date(autoPay.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="payment-creator">By: {autoPay.creator.substring(0, 6)}...{autoPay.creator.substring(38)}</div>
                {autoPay.isVerified && autoPay.decryptedValue && (
                  <div className="payment-amount">Amount: {autoPay.decryptedValue}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateAutoPay 
          onSubmit={createAutoPay} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingAutoPay} 
          autoPayData={newAutoPayData} 
          setAutoPayData={setNewAutoPayData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAutoPay && (
        <AutoPayDetailModal 
          autoPay={selectedAutoPay} 
          onClose={() => { 
            setSelectedAutoPay(null); 
            setDecryptedData({ amount: null, condition: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedAutoPay.paymentAmount)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
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

const ModalCreateAutoPay: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  autoPayData: any;
  setAutoPayData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, autoPayData, setAutoPayData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setAutoPayData({ ...autoPayData, [name]: intValue });
    } else {
      setAutoPayData({ ...autoPayData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-autopay-modal metal-panel">
        <div className="modal-header">
          <h2>New Auto-Pay Condition</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Payment amount will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Payment Name *</label>
            <input 
              type="text" 
              name="name" 
              value={autoPayData.name} 
              onChange={handleChange} 
              placeholder="Enter payment name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Payment Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={autoPayData.amount} 
              onChange={handleChange} 
              placeholder="Enter payment amount..." 
              step="1"
              min="0"
              className="metal-input"
            />
            <div className="data-type-label">🔐 FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Trigger Condition *</label>
            <input 
              type="number" 
              min="1" 
              max="100" 
              name="condition" 
              value={autoPayData.condition} 
              onChange={handleChange} 
              placeholder="Enter condition value..." 
              className="metal-input"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !autoPayData.name || !autoPayData.amount || !autoPayData.condition} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Auto-Pay"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AutoPayDetailModal: React.FC<{
  autoPay: AutoPayData;
  onClose: () => void;
  decryptedData: { amount: number | null; condition: number | null };
  setDecryptedData: (value: { amount: number | null; condition: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ autoPay, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.amount !== null) { 
      setDecryptedData({ amount: null, condition: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ amount: decrypted, condition: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="autopay-detail-modal metal-panel">
        <div className="modal-header">
          <h2>Auto-Pay Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="autopay-info">
            <div className="info-item">
              <span>Payment Name:</span>
              <strong>{autoPay.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{autoPay.creator.substring(0, 6)}...{autoPay.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(autoPay.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Trigger Condition:</span>
              <strong>{autoPay.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>🔐 Encrypted Payment Data</h3>
            
            <div className="data-row">
              <div className="data-label">Payment Amount:</div>
              <div className="data-value">
                {autoPay.isVerified && autoPay.decryptedValue ? 
                  `${autoPay.decryptedValue} (Verified)` : 
                  decryptedData.amount !== null ? 
                  `${decryptedData.amount} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(autoPay.isVerified || decryptedData.amount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : autoPay.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.amount !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protection Active</strong>
                <p>Payment amount is encrypted on-chain. Verify to decrypt and validate the encrypted data.</p>
              </div>
            </div>
          </div>
          
          {(autoPay.isVerified || decryptedData.amount !== null) && (
            <div className="analysis-section">
              <h3>Payment Analysis</h3>
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Payment Amount:</span>
                  <strong>
                    {autoPay.isVerified ? 
                      `${autoPay.decryptedValue}` : 
                      `${decryptedData.amount}`
                    }
                  </strong>
                  <span className={`data-badge ${autoPay.isVerified ? 'verified' : 'local'}`}>
                    {autoPay.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Trigger Condition:</span>
                  <strong>{autoPay.publicValue1}</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!autoPay.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


