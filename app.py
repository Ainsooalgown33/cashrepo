from flask import Flask, request, jsonify, render_template

app = Flask(__name__, template_folder=".")

# This will act as our temporary database
transactions = []

@app.route('/')
def index():
    # Serves the HTML frontend
    return render_template('index.html')

@app.route('/add_data', methods=['POST'])
def add_data():
    data = request.get_json()
    
    # Extract data from the clerk's input
    item_name = data.get('item_name')
    category = data.get('category')
    quantity = int(data.get('quantity', 1))
    price = float(data.get('price', 0.0))
    total = quantity * price
    
    # Create a record
    record = {
        'item_name': item_name,
        'category': category,
        'quantity': quantity,
        'price': price,
        'total': total
    }
    
    # Add to our list
    transactions.append(record)
    
    return jsonify({"message": "Data added successfully!", "status": "success"})

@app.route('/get_sorted_data', methods=['GET'])
def get_sorted_data():
    # Automatically sort the data for processing. 
    # Here, we are sorting alphabetically by 'category', then by 'item_name'
    sorted_transactions = sorted(transactions, key=lambda x: (x['category'], x['item_name']))
    
    return jsonify(sorted_transactions)

if __name__ == '__main__':
    app.run(debug=True)