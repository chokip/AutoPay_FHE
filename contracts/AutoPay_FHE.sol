pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AutoPay_FHE is ZamaEthereumConfig {
    struct PaymentCondition {
        euint32 encryptedThreshold;
        uint256 publicMultiplier;
        uint256 paymentAmount;
        address recipient;
        bool isActive;
        uint256 lastExecution;
    }

    mapping(uint256 => PaymentCondition) public conditions;
    uint256 public nextConditionId = 1;

    event ConditionCreated(uint256 indexed conditionId, address indexed creator);
    event PaymentExecuted(uint256 indexed conditionId, uint256 amount);

    constructor() ZamaEthereumConfig() {}

    function createCondition(
        externalEuint32 encryptedThreshold,
        bytes calldata inputProof,
        uint256 publicMultiplier,
        uint256 paymentAmount,
        address recipient
    ) external {
        require(paymentAmount > 0, "Invalid payment amount");
        require(recipient != address(0), "Invalid recipient");

        require(FHE.isInitialized(FHE.fromExternal(encryptedThreshold, inputProof)), "Invalid encrypted input");

        uint256 conditionId = nextConditionId++;
        conditions[conditionId] = PaymentCondition({
            encryptedThreshold: FHE.fromExternal(encryptedThreshold, inputProof),
            publicMultiplier: publicMultiplier,
            paymentAmount: paymentAmount,
            recipient: recipient,
            isActive: true,
            lastExecution: 0
        });

        FHE.allowThis(conditions[conditionId].encryptedThreshold);
        FHE.makePubliclyDecryptable(conditions[conditionId].encryptedThreshold);

        emit ConditionCreated(conditionId, msg.sender);
    }

    function executePayment(uint256 conditionId, bytes calldata computationProof) external {
        PaymentCondition storage condition = conditions[conditionId];
        require(condition.isActive, "Condition not active");
        require(block.timestamp > condition.lastExecution + 1 days, "Execution cooldown");

        euint32 result;
        bool comparisonResult;
        (result, comparisonResult) = FHE.compute(
            abi.encodePacked(condition.encryptedThreshold),
            abi.encodePacked(condition.publicMultiplier),
            computationProof
        );

        require(comparisonResult, "Threshold not met");
        require(address(this).balance >= condition.paymentAmount, "Insufficient contract balance");

        condition.lastExecution = block.timestamp;
        payable(condition.recipient).transfer(condition.paymentAmount);

        emit PaymentExecuted(conditionId, condition.paymentAmount);
    }

    function updateCondition(
        uint256 conditionId,
        externalEuint32 newEncryptedThreshold,
        bytes calldata inputProof,
        uint256 newPublicMultiplier,
        uint256 newPaymentAmount,
        address newRecipient
    ) external {
        PaymentCondition storage condition = conditions[conditionId];
        require(condition.isActive, "Condition not active");

        require(newPaymentAmount > 0, "Invalid payment amount");
        require(newRecipient != address(0), "Invalid recipient");
        require(FHE.isInitialized(FHE.fromExternal(newEncryptedThreshold, inputProof)), "Invalid encrypted input");

        FHE.disallowThis(condition.encryptedThreshold);

        condition.encryptedThreshold = FHE.fromExternal(newEncryptedThreshold, inputProof);
        condition.publicMultiplier = newPublicMultiplier;
        condition.paymentAmount = newPaymentAmount;
        condition.recipient = newRecipient;

        FHE.allowThis(condition.encryptedThreshold);
        FHE.makePubliclyDecryptable(condition.encryptedThreshold);
    }

    function toggleCondition(uint256 conditionId) external {
        PaymentCondition storage condition = conditions[conditionId];
        condition.isActive = !condition.isActive;
    }

    function withdrawBalance() external {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}

    function getCondition(uint256 conditionId) external view returns (
        euint32 encryptedThreshold,
        uint256 publicMultiplier,
        uint256 paymentAmount,
        address recipient,
        bool isActive,
        uint256 lastExecution
    ) {
        PaymentCondition storage condition = conditions[conditionId];
        return (
            condition.encryptedThreshold,
            condition.publicMultiplier,
            condition.paymentAmount,
            condition.recipient,
            condition.isActive,
            condition.lastExecution
        );
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}


