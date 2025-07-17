# Requires transformers>=4.51.0
# Requires sentence-transformers>=2.7.0

from transformers import AutoTokenizer, AutoModel
import torch

# Load tokenizer and model
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen3-Embedding-0.6B")
model = AutoModel.from_pretrained("Qwen/Qwen3-Embedding-0.6B")

# Example sentences
sentences = [
    "What is the capital of China?",
    "Explain gravity"
]

# Tokenize
inputs = tokenizer(sentences, padding=True, truncation=True, return_tensors="pt")

# Get embeddings
with torch.no_grad():
    outputs = model(**inputs)
    embeddings = outputs.last_hidden_state.mean(dim=1)  # Mean pooling

print(embeddings)